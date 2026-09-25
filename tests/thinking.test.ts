import assert from "node:assert/strict";
import test from "node:test";
import { TelegramSessionConnection } from "../src/telegram.ts";

const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
const ok = (result: unknown = true) => new Response(JSON.stringify({ ok: true, result }));
const incoming = (text: string) => ({ update_id: 1, message: { message_id: 1, text, chat: { id: 42, type: "private" }, from: { id: 42, is_bot: false } } });

test("Thinking start is fixed and independent; handoff returns a real normal draft using a new native ID", async () => {
  const original = globalThis.fetch, calls: Array<{ method: string; body: any }> = [];
  globalThis.fetch = (async (url, init) => {
    const method = String(url).split("/").at(-1)!; calls.push({ method, body: JSON.parse(String(init?.body)) });
    return ok(method === "sendMessage" || method === "sendRichMessage" ? { message_id: 10 } : true);
  }) as typeof fetch;
  const c = new TelegramSessionConnection("placeholder", 42);
  try {
    await c.activity("working"); await c.chatAction("typing", 30);
    const working = (c as any).workingStatus, typing = (c as any).chatActionRun;
    const { thinkingRef } = await c.thinking("start", {}); assert.ok(thinkingRef);
    assert.equal((c as any).thinkingRun.mode, "refreshing"); // Default30, return before window ends.
    assert.equal((c as any).workingStatus, working); assert.equal((c as any).chatActionRun, typing);
    const native = calls.find(c => c.method === "sendRichMessageDraft")!;
    assert.deepEqual(native.body, { chat_id: 42, draft_id: native.body.draft_id, rich_message: { blocks: [{ type: "thinking", text: "Thinking…" }] }, can_stop: false });
    const { draftRef } = await c.thinking("handoff", { thinkingRef, message: "Answer preview" }); assert.ok(draftRef);
    assert.notEqual(calls.find(c => c.method === "sendMessageDraft")!.body.draft_id, native.body.draft_id);
    assert.equal((c as any).thinkingRun, undefined); assert.equal((c as any).outboundDraft.ref, draftRef);
    assert.ok(!calls.some(c => c.method === "sendRichMessage")); // Handoff is transient.
    await c.draft("update", { draftRef, message: "Full replacement" });
    assert.ok((await c.draft("finalize", { draftRef })).messageRef);
    await assert.rejects(c.thinking("stop", { thinkingRef }), /retired/);
  } finally { await c.stop(); globalThis.fetch = original; }
});

test("explicit stop is local/idempotent and retains a reference for immediate handoff", async () => {
  const original = globalThis.fetch, calls: string[] = [];
  globalThis.fetch = (async url => { calls.push(String(url).split("/").at(-1)!); return ok(); }) as typeof fetch;
  const c = new TelegramSessionConnection("placeholder", 42);
  try {
    const { thinkingRef } = await c.thinking("start", {});
    await assert.rejects(c.thinking("start", {}), /active or settling/);
    await assert.rejects(c.draft("start", { message: "conflict" }), /Thinking is active/);
    assert.deepEqual(await c.thinking("stop", { thinkingRef }), { thinkingRef });
    assert.deepEqual(await c.thinking("stop", { thinkingRef }), { thinkingRef });
    assert.deepEqual(calls, ["sendRichMessageDraft"]); // No fictional clear API.
    assert.ok((await c.thinking("handoff", { thinkingRef, message: "No expiry wait" })).draftRef);
  } finally { await c.stop(); globalThis.fetch = original; }
});

test("ended metadata does not lock the preview; new starts retire stale Thinking references", async t => {
  const original = globalThis.fetch; let calls = 0;
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1000 });
  globalThis.fetch = (async () => { calls++; return ok(); }) as typeof fetch;
  const c = new TelegramSessionConnection("placeholder", 42);
  try {
    const { thinkingRef } = await c.thinking("start", { refreshSeconds: 30 });
    t.mock.timers.tick(4000); await tick(); assert.equal(calls, 2);
    t.mock.timers.tick(26000); await tick(); assert.equal(calls, 2); assert.equal((c as any).thinkingRun.ref, thinkingRef);
    assert.equal((c as any).thinkingRun.mode, "stopped");
    const replacement = await c.thinking("start", { refreshSeconds: 0 });
    await assert.rejects(c.thinking("stop", { thinkingRef }), /retired/);
    const answer = await c.draft("start", { message: "independent restart" });
    await assert.rejects(c.thinking("handoff", { thinkingRef: replacement.thinkingRef, message: "stale" }), /retired/);
    await assert.rejects(c.thinking("start", {}), /answer draft is active/);
    assert.equal((c as any).outboundDraft.ref, answer.draftRef);
  } finally { await c.stop(); t.mock.timers.reset(); globalThis.fetch = original; }
});

test("queued answer starts reserve the preview before their first network request", async () => {
  const original = globalThis.fetch, held = deferred<Response>(), entered = deferred<void>(); let hold = true;
  globalThis.fetch = (async url => {
    if (String(url).endsWith("/sendRichMessage") && hold) { entered.resolve(); return held.promise; }
    return ok();
  }) as typeof fetch;
  const c = new TelegramSessionConnection("placeholder", 42);
  try {
    const post = c.post("held"), cancelledPost = assert.rejects(post); await entered.promise;
    const draft = c.draft("start", { message: "queued" }), cancelledDraft = assert.rejects(draft);
    await assert.rejects(c.thinking("start", {}), /answer draft is active or starting/);
    (c as any).cancelOperations(); await cancelledPost; await cancelledDraft;
    assert.equal((c as any).answerDraftStarts, 0);
    hold = false; await c.thinking("start", { refreshSeconds: 0 }); held.resolve(ok({ message_id: 10 }));
  } finally { held.resolve(ok({ message_id: 10 })); await c.stop(); globalThis.fetch = original; }
});

test("stop freezes scheduling without aborting an issued pulse; handoff waits for positive completion", async t => {
  const original = globalThis.fetch, held = deferred<Response>(); let pulses = 0, answers = 0, pulseSignal: AbortSignal | undefined;
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1000 });
  globalThis.fetch = (async (url, init) => {
    if (String(url).endsWith("/sendRichMessageDraft") && ++pulses === 2) { pulseSignal = init!.signal!; return held.promise; }
    if (String(url).endsWith("/sendMessageDraft")) answers++;
    return ok();
  }) as typeof fetch;
  const c = new TelegramSessionConnection("placeholder", 42);
  try {
    const { thinkingRef } = await c.thinking("start", {});
    t.mock.timers.tick(4000); await tick(); assert.equal(pulses, 2);
    await c.thinking("stop", { thinkingRef }); assert.equal(pulseSignal!.aborted, false);
    const handoff = c.thinking("handoff", { thinkingRef, message: "Answer" }); await tick(); assert.equal(answers, 0);
    await assert.rejects(c.thinking("handoff", { thinkingRef, message: "duplicate" }), /already pending/);
    await assert.rejects(c.thinking("start", {}), /active or settling/);
    held.resolve(ok()); assert.ok((await handoff).draftRef); assert.equal(answers, 1);
    t.mock.timers.tick(30000); await tick(); assert.equal(pulses, 2);
  } finally { held.resolve(ok()); await c.stop(); t.mock.timers.reset(); globalThis.fetch = original; }
});

test("intentional stop/handoff stays quiet while an issued uncertain pulse still warns", async t => {
  const original = globalThis.fetch, held = deferred<Response>(); let hold = false, warnings = 0;
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 100_000 });
  globalThis.fetch = (async url => {
    if (hold && String(url).endsWith("/sendRichMessageDraft")) return held.promise;
    return ok();
  }) as typeof fetch;
  const c = new TelegramSessionConnection("placeholder", 42, { onDraftError: () => { warnings++; } });
  try {
    const stopped = await c.thinking("start", {});
    await c.thinking("stop", { thinkingRef: stopped.thinkingRef }); await tick();
    assert.equal(warnings, 0);
    const replacement = await c.thinking("start", {});
    const answer = await c.thinking("handoff", { thinkingRef: replacement.thinkingRef, message: "Answer" }); await tick();
    assert.equal(warnings, 0);
    await c.draft("discard", { draftRef: answer.draftRef });
    const failing = await c.thinking("start", {}); hold = true;
    t.mock.timers.tick(4000); await tick();
    await c.thinking("stop", { thinkingRef: failing.thinkingRef });
    held.resolve(new Response(JSON.stringify({ ok: false, error_code: 500, description: "Server error" }), { status: 500 }));
    await tick(); assert.equal(warnings, 1); assert.equal((c as any).previewUncertain, true);
  } finally { held.resolve(ok()); await c.stop(); t.mock.timers.reset(); globalThis.fetch = original; }
});

test("uncertain pulse outcome fences all new previews until teardown but not persistent posts", async () => {
  const original = globalThis.fetch, body = deferred<any>(); let pulses = 0;
  globalThis.fetch = (async (url: RequestInfo | URL) => {
    if (String(url).endsWith("/sendRichMessageDraft")) { pulses++; return { ok: true, json: () => body.promise }; }
    return ok({ message_id: 10 });
  }) as unknown as typeof fetch;
  const c = new TelegramSessionConnection("private-placeholder", 42), keepAlive = setTimeout(() => {}, 3000);
  try {
    await assert.rejects(c.thinking("start", { refreshSeconds: 1 }), /delivery is unknown/);
    const thinkingRef = (c as any).thinkingRun.ref;
    await assert.rejects(c.thinking("stop", { thinkingRef }), /delivery is unknown/);
    await assert.rejects(c.thinking("handoff", { thinkingRef, message: "unsafe" }), /delivery is unknown/);
    await assert.rejects(c.thinking("start", {}), /delivery is unknown/);
    await assert.rejects(c.draft("start", { message: "unsafe" }), /delivery is unknown/);
    assert.ok((await c.post("Persistent fallback" )).messageRef);
    body.resolve({ ok: true, result: true }); await tick();
    await assert.rejects(c.draft("start", { message: "still unknown" }), /delivery is unknown/); assert.equal(pulses, 1);
  } finally { clearTimeout(keepAlive); body.resolve({ ok: true, result: true }); await c.stop(); globalThis.fetch = original; }
});

test("uncertain handoff issues no usable draftRef and cannot replay or bypass its fence", async () => {
  const original = globalThis.fetch; let writes = 0;
  globalThis.fetch = (async url => {
    if (String(url).endsWith("/sendMessageDraft")) { writes++; throw new Error("private network details"); }
    return ok();
  }) as typeof fetch;
  const c = new TelegramSessionConnection("placeholder", 42);
  try {
    const { thinkingRef } = await c.thinking("start", { refreshSeconds: 0 });
    await assert.rejects(c.thinking("handoff", { thinkingRef, message: "preview" }), /delivery is unknown/);
    assert.equal((c as any).outboundDraft, undefined);
    await assert.rejects(c.thinking("handoff", { thinkingRef, message: "retry" }), /delivery is unknown/);
    await assert.rejects(c.draft("start", { message: "bypass" }), /delivery is unknown/);
    await assert.rejects(c.thinking("stop", { thinkingRef }), /delivery is unknown/); assert.equal(writes, 1);
  } finally { await c.stop(); globalThis.fetch = original; }
});

test("pre-I/O validation and queued handoff cancellation do not poison a confirmed preview", async () => {
  const original = globalThis.fetch; globalThis.fetch = (async () => ok()) as typeof fetch;
  const c = new TelegramSessionConnection("placeholder", 42);
  try {
    for (const seconds of [-1, 31, 1.5, NaN]) await assert.rejects(c.thinking("start", { refreshSeconds: seconds }), /integer/);
    await assert.rejects(c.thinking("start", { message: "custom reasoning" }), /only refreshSeconds/);
    const { thinkingRef } = await c.thinking("start", { refreshSeconds: 0 });
    await assert.rejects(c.thinking("handoff", { thinkingRef }), /full message/);
    await assert.rejects(c.thinking("handoff", { thinkingRef, message: "cancelled" }, AbortSignal.abort()), /before delivery/);
    assert.equal((c as any).previewUncertain, false);
    assert.ok((await c.thinking("handoff", { thinkingRef, message: "valid" })).draftRef);
  } finally { await c.stop(); globalThis.fetch = original; }
});

test("owner Stop fences held Thinking synchronously without borrowing console abort authority", async () => {
  const original = globalThis.fetch, held = deferred<Response>(), entered = deferred<void>(); let admitted = 0, hostAborts = 0;
  globalThis.fetch = (async url => {
    if (String(url).endsWith("/sendRichMessageDraft")) { entered.resolve(); return held.promise; }
    return ok({ message_id: 10 });
  }) as typeof fetch;
  const c = new TelegramSessionConnection("placeholder", 42, { canStop: () => false });
  try {
    const pending = c.thinking("start", {}), rejected = assert.rejects(pending, /delivery is unknown/); await entered.promise;
    (c as any).dispatch(incoming("ordinary"), () => { admitted++; }, () => { hostAborts++; }, () => "", () => false);
    assert.equal(admitted, 1); assert.ok((await c.post("independent")).messageRef);
    (c as any).dispatch(incoming("/stop"), () => {}, () => { hostAborts++; }, () => "", () => false);
    await assert.rejects(c.draft("start", { message: "same-tick bypass" }), /delivery is unknown/);
    await rejected; assert.equal(hostAborts, 0); assert.equal((c as any).thinkingRun, undefined);
  } finally { held.resolve(ok()); await c.stop(); globalThis.fetch = original; }
});
