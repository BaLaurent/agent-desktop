// Ported from src/main/services/deeplink.test.ts. Under deno desktop the runtime deep-link
// surface is reduced to the pure `agent://conversation/<id>` parser (scheme registration is
// declarative in deno.json; argv delivery lives in singleInstance.ts). The Electron test drove
// app.on('open-url')/'second-instance' handlers and asserted webContents.send('deeplink:navigate',
// id) — that side is now the single-instance guard's job. What remains testable, and what the
// original navigation assertions actually pinned, is the URL→conversationId mapping:
//   agent://conversation/123 -> 123 ; invalid/missing id -> null ; malformed URL -> null ;
//   unrecognized host -> null.
import { assertEquals } from "jsr:@std/assert";
import { parseDeepLink } from "./deeplink.ts";

Deno.test("parses agent://conversation/<id> to the numeric id", () => {
  assertEquals(parseDeepLink("agent://conversation/123"), 123);
  assertEquals(parseDeepLink("agent://conversation/456"), 456);
});

Deno.test("ignores a non-numeric conversation id", () => {
  assertEquals(parseDeepLink("agent://conversation/invalid"), null);
});

Deno.test("ignores a missing conversation id", () => {
  assertEquals(parseDeepLink("agent://conversation/"), null);
  assertEquals(parseDeepLink("agent://conversation"), null);
});

Deno.test("returns null for a malformed URL", () => {
  assertEquals(parseDeepLink("not-a-valid-url-at-all"), null);
  assertEquals(parseDeepLink("some-other-arg"), null);
});

Deno.test("returns null for an unrecognized agent host", () => {
  assertEquals(parseDeepLink("agent://unknown/path"), null);
});

Deno.test("takes only the first path segment as the id", () => {
  assertEquals(parseDeepLink("agent://conversation/123/extra"), 123);
});
