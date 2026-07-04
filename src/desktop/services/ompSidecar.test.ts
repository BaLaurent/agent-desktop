// Ported from src/main/services/ompSidecar.test.ts. The Electron test mocked electron only because
// the module imported `app` at top level; the ported ompSidecar.ts is Electron-free (userDataDir
// from ../paths), so no mocking is needed. Every assertion here targets the PURE decision helpers —
// semver parsing, range membership, latest-in-range selection, and the install/update/use decision —
// exactly as the original did. The network/child-process side of ensureOmpBinary() is an E2E concern
// and is not unit-tested (same boundary the Electron test drew).
import { assertEquals } from "jsr:@std/assert";
import {
  parseSemver,
  parseVersionOutput,
  cmpSemver,
  isInSupportedRange,
  pickLatestInRange,
  decideOmpAction,
} from "./ompSidecar.ts";

Deno.test("parseSemver", async (t) => {
  await t.step("parses an x.y.z string, tolerating a leading v", () => {
    assertEquals(parseSemver("v16.2.13"), { major: 16, minor: 2, patch: 13 });
    assertEquals(parseSemver("16.2.13"), { major: 16, minor: 2, patch: 13 });
  });
  await t.step("returns null for a non-version string", () => {
    assertEquals(parseSemver("nope"), null);
  });
});

Deno.test("parseVersionOutput extracts the version from `omp --version` output", () => {
  assertEquals(parseVersionOutput("omp/16.2.13"), { major: 16, minor: 2, patch: 13 });
});

Deno.test("cmpSemver orders by major, then minor, then patch", () => {
  const v = parseSemver("16.2.13")!;
  assertEquals(cmpSemver(parseSemver("16.2.12")!, v), -1);
  assertEquals(cmpSemver(v, v), 0);
  assertEquals(cmpSemver(parseSemver("16.3.0")!, v), 1);
  assertEquals(cmpSemver(parseSemver("17.0.0")!, v), 1);
});

Deno.test("isInSupportedRange accepts [16.2.0, 17.0.0) and rejects the rest", () => {
  assertEquals(isInSupportedRange(parseSemver("16.2.0")!), true);
  assertEquals(isInSupportedRange(parseSemver("16.9.9")!), true);
  assertEquals(isInSupportedRange(parseSemver("17.0.0")!), false);
  assertEquals(isInSupportedRange(parseSemver("15.9.9")!), false);
  assertEquals(isInSupportedRange(parseSemver("16.1.9")!), false);
});

Deno.test("pickLatestInRange", async (t) => {
  await t.step("returns the highest in-range tag and excludes out-of-range ones", () => {
    assertEquals(pickLatestInRange(["v16.2.11", "v16.2.13", "v17.0.0", "v15.1.0"]), {
      tag: "v16.2.13",
      version: { major: 16, minor: 2, patch: 13 },
    });
  });
  await t.step("returns null when nothing is in range", () => {
    assertEquals(pickLatestInRange(["v17.0.0"]), null);
  });
});

Deno.test("decideOmpAction", async (t) => {
  const latest = { tag: "v16.2.13", version: parseSemver("16.2.13")! };

  await t.step("uses the PATH binary when in range (even if a newer in-range release exists)", () => {
    assertEquals(decideOmpAction({ pathVersion: parseSemver("16.2.0")!, managedVersion: null, latestInRange: latest }), { kind: "use-path" });
  });
  await t.step("installs the latest in-range release when PATH is out of range and no managed binary exists", () => {
    assertEquals(decideOmpAction({ pathVersion: parseSemver("17.0.0")!, managedVersion: null, latestInRange: latest }), { kind: "install", tag: "v16.2.13" });
  });
  await t.step("uses the managed binary when it already matches the latest in-range release", () => {
    assertEquals(decideOmpAction({ pathVersion: null, managedVersion: parseSemver("16.2.13")!, latestInRange: latest }), { kind: "use-managed" });
  });
  await t.step("updates the managed binary when it is older than the latest in-range release", () => {
    assertEquals(decideOmpAction({ pathVersion: null, managedVersion: parseSemver("16.2.11")!, latestInRange: latest }), { kind: "update", tag: "v16.2.13" });
  });
  await t.step("returns none when there is no PATH binary, no managed binary, and nothing in range", () => {
    assertEquals(decideOmpAction({ pathVersion: null, managedVersion: null, latestInRange: null }), { kind: "none" });
  });
});
