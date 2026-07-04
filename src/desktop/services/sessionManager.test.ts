// Ported from src/main/services/sessionManager.test.ts. Two tiers in the Electron original:
//   1. PromptController (a pure async-iterable) — fully portable, ported here in full.
//   2. "SessionManager API" — those tests hinge on vi.mock('./anthropic') replacing loadAgentSDK
//      with a fake query() plus vi.resetModules() to reset the module-level sessions Map. A plain
//      `deno test <file>` invocation cannot replace an ES-module import or reset module state, so the
//      SDK-DRIVEN cases (sendTurn resolves on result, invalidateSession aborts a pending turn,
//      reconnect-between-turns, etc.) are NOT portable and are documented in the skip report. What
//      IS portable without any SDK is the empty-state surface (queries against a fresh, session-less
//      module), ported below — identical assertions to the Electron test's no-session cases.
//
// The waiting/ordering PromptController assertions are made deterministic by stepping the async
// iterator's .next() and racing against a microtask, rather than sleeping a wall-clock duration.
import { assertEquals } from "jsr:@std/assert";
import type { ToolApprovalResponse } from "../../shared/types.ts";
import {
  PromptController,
  hasActiveSession,
  getSession,
  invalidateSession,
  shutdownAllSessions,
  respondToSessionApproval,
} from "./sessionManager.ts";

interface UserMsg {
  type: "user";
  message: { role: "user"; content: string };
  parent_tool_use_id: null;
  session_id: string;
}

function mkMsg(content: string): UserMsg {
  return { type: "user", message: { role: "user", content }, parent_tool_use_id: null, session_id: "" };
}

Deno.test("PromptController", async (t) => {
  await t.step("yields pushed messages in order", async () => {
    const ctrl = new PromptController();
    ctrl.push(mkMsg("hello") as unknown as Parameters<PromptController["push"]>[0]);
    ctrl.push(mkMsg("world") as unknown as Parameters<PromptController["push"]>[0]);
    ctrl.close();

    const results: string[] = [];
    for await (const m of ctrl) results.push((m as unknown as UserMsg).message.content);
    assertEquals(results, ["hello", "world"]);
  });

  await t.step("waits for messages when the queue is empty, then delivers a late push", async () => {
    const ctrl = new PromptController();
    const it = ctrl[Symbol.asyncIterator]();
    const pending = it.next(); // queue empty → parks on the internal waiter

    // Prove it hasn't resolved yet: a plain microtask wins the race while next() is still parked.
    const raced = await Promise.race([pending.then(() => "resolved"), Promise.resolve("pending")]);
    assertEquals(raced, "pending");

    ctrl.push(mkMsg("delayed") as unknown as Parameters<PromptController["push"]>[0]);
    const first = await pending;
    assertEquals(first.done, false);
    assertEquals((first.value as unknown as UserMsg).message.content, "delayed");
  });

  await t.step("stops iteration when closed with an empty queue", async () => {
    const ctrl = new PromptController();
    ctrl.close();
    const results: unknown[] = [];
    for await (const m of ctrl) results.push(m);
    assertEquals(results.length, 0);
  });

  await t.step("drains remaining messages before stopping on close", async () => {
    const ctrl = new PromptController();
    ctrl.push(mkMsg("last") as unknown as Parameters<PromptController["push"]>[0]);
    ctrl.close();
    const results: string[] = [];
    for await (const m of ctrl) results.push((m as unknown as UserMsg).message.content);
    assertEquals(results, ["last"]);
  });

  await t.step("ignores push after close", async () => {
    const ctrl = new PromptController();
    ctrl.close();
    ctrl.push(mkMsg("ignored") as unknown as Parameters<PromptController["push"]>[0]);
    const results: unknown[] = [];
    for await (const m of ctrl) results.push(m);
    assertEquals(results.length, 0);
  });

  await t.step("isClosed reflects state", () => {
    const ctrl = new PromptController();
    assertEquals(ctrl.isClosed, false);
    ctrl.close();
    assertEquals(ctrl.isClosed, true);
  });

  await t.step("iterates across multiple sequential pushes and waits", async () => {
    const ctrl = new PromptController();
    const it = ctrl[Symbol.asyncIterator]();

    ctrl.push(mkMsg("turn1") as unknown as Parameters<PromptController["push"]>[0]);
    assertEquals(((await it.next()).value as unknown as UserMsg).message.content, "turn1");

    // Queue now empty — next() parks until the next push.
    const p2 = it.next();
    assertEquals(await Promise.race([p2.then(() => "resolved"), Promise.resolve("pending")]), "pending");
    ctrl.push(mkMsg("turn2") as unknown as Parameters<PromptController["push"]>[0]);
    assertEquals(((await p2).value as unknown as UserMsg).message.content, "turn2");

    ctrl.push(mkMsg("turn3") as unknown as Parameters<PromptController["push"]>[0]);
    ctrl.close();
    assertEquals(((await it.next()).value as unknown as UserMsg).message.content, "turn3");
    assertEquals((await it.next()).done, true);
  });
});

// Empty-state API — no SDK, no sessions. Mirrors the Electron test's no-session cases exactly.
Deno.test("SessionManager API (empty state)", async (t) => {
  await t.step("hasActiveSession returns false for an unknown conversation", () => {
    assertEquals(hasActiveSession(999), false);
  });

  await t.step("getSession returns null for an unknown conversation", () => {
    assertEquals(getSession(999), null);
  });

  await t.step("invalidateSession is a no-op for an unknown conversation", () => {
    invalidateSession(999); // must not throw
    assertEquals(hasActiveSession(999), false);
  });

  await t.step("shutdownAllSessions is a no-op with no sessions", () => {
    shutdownAllSessions(); // must not throw
  });

  await t.step("respondToSessionApproval returns false when no sessions exist", () => {
    assertEquals(respondToSessionApproval("req-1", { behavior: "allow" } as unknown as ToolApprovalResponse), false);
  });
});
