// Ported from src/main/services/updater.test.ts. The Electron service was REDESIGNED for deno
// desktop (decided update strategy): electron-updater/autoUpdater is gone, replaced by a GitHub
// releases API version check + open-the-release-page. So the original electron-updater assertions
// (autoDownload, quitAndInstall, initAutoUpdater, checkForUpdates, installUpdate) no longer have
// counterparts and are intentionally dropped. What is preserved — and what this test pins — is the
// channel contract the renderer relies on: updates:check returns {available,version?,releaseDate?},
// updates:getStatus returns the last UpdateStatus, and updates:download/install open the release
// page. This also fulfils the plan's verification-5: "mock GitHub API JSON → updates:status fires
// with available:true when remote > local".
//
// Seams used (all real, no ES-module mocking): global `fetch` (stubbed), the `broadcast()` sink
// (captured via addBroadcastHandler), and `Deno.Command` (stubbed to capture the opener spawn).
import { assertEquals } from "jsr:@std/assert";
import { stub } from "jsr:@std/testing/mock";
import type { HandleRegistrar } from "../../core/dispatch.ts";
import type { UpdateInfo, UpdateStatus } from "../../shared/types.ts";
import { addBroadcastHandler } from "../../core/utils/broadcast.ts";
import { registerHandlers } from "./updater.ts";

interface TestDispatch extends HandleRegistrar {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
}

function makeDispatch(): TestDispatch {
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
  return {
    handle(channel, listener) {
      handlers.set(channel, listener);
    },
    async invoke(channel, ...args) {
      const handler = handlers.get(channel);
      if (!handler) throw new Error(`No handler for ${channel}`);
      return await handler(null, ...args);
    },
  };
}

function githubResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function captureStatuses(): { statuses: UpdateStatus[]; stop: () => void } {
  const statuses: UpdateStatus[] = [];
  const stop = addBroadcastHandler((channel, ...args) => {
    if (channel === "updates:status") statuses.push(args[0] as UpdateStatus);
  });
  return { statuses, stop };
}

// registerHandlers() calls startPassiveChecks(), which schedules a setTimeout + setInterval. Those
// would fire runCheck() (real fetch) and leak timers past the test. Neutralize both globals ONLY for
// the registration call, then restore — the passive schedule is not what we're testing here.
const timeoutStub = stub(globalThis, "setTimeout", (() => 0) as unknown as typeof setTimeout);
const intervalStub = stub(globalThis, "setInterval", (() => 0) as unknown as typeof setInterval);
const dispatch = makeDispatch();
registerHandlers(dispatch, undefined);
timeoutStub.restore();
intervalStub.restore();

Deno.test("updater (GitHub version check)", async (t) => {
  // Runs first, before any check mutates module state: default status is idle.
  await t.step("updates:getStatus returns idle by default", async () => {
    assertEquals(await dispatch.invoke("updates:getStatus"), { state: "idle" });
  });

  await t.step("updates:check returns available + broadcasts when remote is newer", async () => {
    const fetchStub = stub(
      globalThis,
      "fetch",
      // Fake GitHub "latest release" newer than appVersion() (0.18.0-dev under `deno test`).
      (() => Promise.resolve(githubResponse({ tag_name: "v0.19.0", html_url: "https://example.test/rel/0.19.0", published_at: "2025-01-15" }))) as unknown as typeof fetch,
    );
    const cap = captureStatuses();
    try {
      const result = (await dispatch.invoke("updates:check")) as UpdateInfo;
      assertEquals(result, { available: true, version: "0.19.0", releaseDate: "2025-01-15" });
      assertEquals(cap.statuses[0], { state: "checking" });
      assertEquals(cap.statuses.at(-1), { state: "available", version: "0.19.0", releaseDate: "2025-01-15" });
    } finally {
      cap.stop();
      fetchStub.restore();
    }
  });

  await t.step("updates:check returns not-available when remote equals local", async () => {
    const fetchStub = stub(
      globalThis,
      "fetch",
      (() => Promise.resolve(githubResponse({ tag_name: "v0.18.0", html_url: "https://example.test/rel/0.18.0", published_at: "2024-01-01" }))) as unknown as typeof fetch,
    );
    const cap = captureStatuses();
    try {
      const result = (await dispatch.invoke("updates:check")) as UpdateInfo;
      assertEquals(result, { available: false, version: "0.18.0", releaseDate: "2024-01-01" });
      assertEquals(cap.statuses.at(-1), { state: "not-available" });
    } finally {
      cap.stop();
      fetchStub.restore();
    }
  });

  await t.step("updates:check returns not-available when remote is older", async () => {
    const fetchStub = stub(
      globalThis,
      "fetch",
      (() => Promise.resolve(githubResponse({ tag_name: "v0.1.0", html_url: "https://example.test/rel/0.1.0" }))) as unknown as typeof fetch,
    );
    try {
      const result = (await dispatch.invoke("updates:check")) as UpdateInfo;
      assertEquals(result.available, false);
      assertEquals(result.version, "0.1.0");
    } finally {
      fetchStub.restore();
    }
  });

  await t.step("updates:check returns {available:false} on non-OK response", async () => {
    const fetchStub = stub(
      globalThis,
      "fetch",
      (() => Promise.resolve(githubResponse({}, 403))) as unknown as typeof fetch,
    );
    const cap = captureStatuses();
    try {
      const result = (await dispatch.invoke("updates:check")) as UpdateInfo;
      assertEquals(result, { available: false });
      assertEquals(cap.statuses.at(-1), { state: "not-available" });
    } finally {
      cap.stop();
      fetchStub.restore();
    }
  });

  await t.step("updates:check returns {available:false} when fetch throws", async () => {
    const fetchStub = stub(
      globalThis,
      "fetch",
      (() => Promise.reject(new Error("network error"))) as unknown as typeof fetch,
    );
    try {
      const result = (await dispatch.invoke("updates:check")) as UpdateInfo;
      assertEquals(result, { available: false });
    } finally {
      fetchStub.restore();
    }
  });

  await t.step("updates:getStatus reflects the last check", async () => {
    const fetchStub = stub(
      globalThis,
      "fetch",
      (() => Promise.resolve(githubResponse({ tag_name: "v9.9.9", html_url: "https://example.test/rel/9.9.9", published_at: "2030-01-01" }))) as unknown as typeof fetch,
    );
    try {
      await dispatch.invoke("updates:check");
      assertEquals(await dispatch.invoke("updates:getStatus"), { state: "available", version: "9.9.9", releaseDate: "2030-01-01" });
    } finally {
      fetchStub.restore();
    }
  });

  await t.step("updates:download opens the latest release page in the browser", async () => {
    // First set latestReleaseUrl via a successful check, then assert download spawns the opener at it.
    const fetchStub = stub(
      globalThis,
      "fetch",
      (() => Promise.resolve(githubResponse({ tag_name: "v9.9.9", html_url: "https://example.test/rel/DOWNLOAD", published_at: "2030-01-01" }))) as unknown as typeof fetch,
    );
    let capturedArgs: string[] | null = null;
    // Capture the opener subprocess without launching a browser. @std/testing/mock's stub wraps the
    // replacement in a spy that invokes it WITHOUT `new`, which a class can't tolerate — so define a
    // plain constructor-function (returns its own object) directly on Deno.Command and restore after.
    const origCommand = Deno.Command;
    function FakeCommand(_cmd: string, opts: { args: string[] }) {
      capturedArgs = opts.args;
      return { spawn() { return { unref() {} }; } };
    }
    Object.defineProperty(Deno, "Command", { value: FakeCommand, configurable: true, writable: true });
    try {
      await dispatch.invoke("updates:check");
      await dispatch.invoke("updates:download");
      assertEquals(capturedArgs !== null && capturedArgs.includes("https://example.test/rel/DOWNLOAD"), true);
    } finally {
      Object.defineProperty(Deno, "Command", { value: origCommand, configurable: true, writable: true });
      fetchStub.restore();
    }
  });

  await t.step("updates:install opens the latest release page in the browser", async () => {
    const fetchStub = stub(
      globalThis,
      "fetch",
      (() => Promise.resolve(githubResponse({ tag_name: "v9.9.9", html_url: "https://example.test/rel/INSTALL", published_at: "2030-01-01" }))) as unknown as typeof fetch,
    );
    let capturedArgs: string[] | null = null;
    const origCommand = Deno.Command;
    function FakeCommand(_cmd: string, opts: { args: string[] }) {
      capturedArgs = opts.args;
      return { spawn() { return { unref() {} }; } };
    }
    Object.defineProperty(Deno, "Command", { value: FakeCommand, configurable: true, writable: true });
    try {
      await dispatch.invoke("updates:check");
      await dispatch.invoke("updates:install");
      assertEquals(capturedArgs !== null && capturedArgs.includes("https://example.test/rel/INSTALL"), true);
    } finally {
      Object.defineProperty(Deno, "Command", { value: origCommand, configurable: true, writable: true });
      fetchStub.restore();
    }
  });
});
