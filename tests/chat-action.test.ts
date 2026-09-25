import assert from "node:assert/strict";
import test from "node:test";
import { TelegramSessionConnection } from "../src/telegram.ts";

const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
const ok = (result: unknown = true) => new Response(JSON.stringify({ ok: true, result }));
const incoming = (text: string) => ({ update_id: 1, message: { message_id: 1, text, chat: { id: 42, type: "private" }, from: { id: 42, is_bot: false } } });

test("native typing defaults to one accepted pulse and leaves draft/Working untouched", async () => {
  const original = globalThis.fetch, calls: Array<{ method: string; body: any }> = [];
  globalThis.fetch = (async (url, init) => {
    const method = String(url).split("/").at(-1)!; calls.push({ method, body: JSON.parse(String(init?.body)) });
    return ok(method === "sendMessage" ? { message_id: 10 } : true);
  }) as typeof fetch;
  const c = new TelegramSessionConnection("placeholder", 42);
  try {
    await c.activity("working"); const draft = await c.draft("start", { message: "preview" });
    const working = (c as any).workingStatus;
    assert.deepEqual(await c.chatAction("typing"), { action: "typing", refreshSeconds: 0 });
    assert.equal((c as any).workingStatus, working); assert.equal((c as any).outboundDraft.ref, draft.draftRef);
    assert.equal((c as any).chatActionRun, undefined);
    assert.deepEqual(calls.filter(c => c.method === "sendChatAction"), [{ method: "sendChatAction", body: { chat_id: 42, action: "typing" } }]);
    for (const seconds of [-1, 31, 1.5, NaN, Infinity]) await assert.rejects(c.chatAction("typing", seconds), /integer from 0 to 30/);
    await assert.rejects(c.chatAction("clear" as any), /Only the typing/);
  } finally { await c.stop(); globalThis.fetch = original; }
});

test("typing returns on first delivery then refreshes on one bounded non-bursting loop", async t => {
  const original = globalThis.fetch; let calls = 0;
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1000 });
  globalThis.fetch = (async () => { calls++; return ok(); }) as typeof fetch;
  const c = new TelegramSessionConnection("placeholder", 42);
  try {
    assert.deepEqual(await c.chatAction("typing", 30), { action: "typing", refreshSeconds: 30 });
    assert.equal(calls, 1); // No duration wait before returning.
    t.mock.timers.tick(4000); await tick(); assert.equal(calls, 2);
    t.mock.timers.tick(26000); await tick();
    assert.equal(calls, 2); assert.equal((c as any).chatActionRun, undefined); // No catch-up burst.
  } finally { await c.stop(); t.mock.timers.reset(); globalThis.fetch = original; }
});

test("superseding a held first pulse cannot let its late result replace the newer loop", async () => {
  const original = globalThis.fetch, held = deferred<Response>(), entered = deferred<void>(); let calls = 0;
  globalThis.fetch = (async () => { if (++calls === 1) { entered.resolve(); return held.promise; } return ok(); }) as typeof fetch;
  const c = new TelegramSessionConnection("placeholder", 42);
  try {
    const first = c.chatAction("typing", 30), rejected = assert.rejects(first, /cancelled/); await entered.promise;
    await c.chatAction("typing", 30); const current = (c as any).chatActionRun;
    await rejected; held.resolve(ok()); await tick();
    assert.equal((c as any).chatActionRun, current); assert.equal(calls, 2);
  } finally { held.resolve(ok()); await c.stop(); globalThis.fetch = original; }
});

test("held typing delivery cannot block ordinary input, explicit posts, or guarded Stop", async () => {
  const original = globalThis.fetch, held = deferred<Response>(), entered = deferred<void>(); let admitted = 0, hostAborts = 0;
  globalThis.fetch = (async url => {
    if (String(url).endsWith("/sendChatAction")) { entered.resolve(); return held.promise; }
    return ok({ message_id: 10 });
  }) as typeof fetch;
  const c = new TelegramSessionConnection("placeholder", 42, { canStop: () => false });
  try {
    const sending = c.chatAction("typing", 30), rejected = assert.rejects(sending, /cancelled/); await entered.promise;
    (c as any).dispatch(incoming("ordinary"), () => { admitted++; }, () => { hostAborts++; }, () => "", () => false);
    assert.equal(admitted, 1); assert.ok((await c.post("independent")).messageRef);
    (c as any).dispatch(incoming("/stop"), () => {}, () => { hostAborts++; }, () => "", () => false);
    await rejected; assert.equal(hostAborts, 0); assert.equal((c as any).chatActionRun, undefined);
    held.resolve(ok()); await tick(); assert.equal((c as any).chatActionRun, undefined);
  } finally { held.resolve(ok()); await c.stop(); globalThis.fetch = original; }
});

test("caller cancellation or disconnect ends background refresh without a fabricated clear action", async () => {
  const original = globalThis.fetch; const bodies: any[] = [];
  globalThis.fetch = (async (_url, init) => { bodies.push(JSON.parse(String(init?.body))); return ok(); }) as typeof fetch;
  try {
    for (const disconnect of [false, true]) {
      const c = new TelegramSessionConnection("placeholder", 42), controller = new AbortController();
      await c.chatAction("typing", 30, controller.signal);
      if (disconnect) await c.stop(); else controller.abort();
      await tick(); assert.equal((c as any).chatActionRun, undefined); await c.stop();
    }
    assert.deepEqual(bodies, [{ chat_id: 42, action: "typing" }, { chat_id: 42, action: "typing" }]);
  } finally { globalThis.fetch = original; }
});

test("refresh lifetime starts at invocation and bounds even a stalled first response body", async () => {
  const original = globalThis.fetch, body = deferred<any>(); let calls = 0;
  globalThis.fetch = (async () => { calls++; return { ok: true, json: () => body.promise }; }) as unknown as typeof fetch;
  const c = new TelegramSessionConnection("private-placeholder", 42);
  const keepAlive = setTimeout(() => {}, 3000); // Mock body has no socket handle; AbortSignal timers are unref'ed.
  try {
    const started = Date.now();
    await assert.rejects(c.chatAction("typing", 1), error => {
      assert.ok(error instanceof Error); assert.match(error.message, /could not be confirmed/); assert.ok(!error.message.includes("private-placeholder")); return true;
    });
    assert.ok(Date.now() - started < 3000); assert.equal(calls, 1); assert.equal((c as any).chatActionRun, undefined);
    body.resolve({ ok: true, result: true }); await tick(); assert.equal((c as any).chatActionRun, undefined);
  } finally { clearTimeout(keepAlive); body.resolve({ ok: true, result: true }); await c.stop(); globalThis.fetch = original; }
});
