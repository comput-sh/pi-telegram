import assert from "node:assert/strict";
import test from "node:test";
import { TelegramSessionConnection } from "../src/telegram.ts";
import { TransportQueue } from "../src/transport-queue.ts";

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
const ok = (result: unknown = { message_id: 10 }) => new Response(JSON.stringify({ ok: true, result }));
const message = (text: string, id = 1) => ({ update_id: id, message: { message_id: id, text, chat: { id: 42, type: "private" }, from: { id: 42, is_bot: false } } });
function dispatch(c: TelegramSessionConnection, update: unknown, input: (m: any) => any = () => {}, stop: () => void = () => {}, status = () => "status") {
  (c as any).dispatch(update, input, stop, status, () => false);
}

test("poll admits a whole ordered batch and Stop while outbound notices/menu/status hang", async () => {
  const original = globalThis.fetch; let polls = 0, stops = 0; const admitted: string[] = [];
  globalThis.fetch = (async (url, init) => {
    const method = String(url).split("/").at(-1);
    if (method === "getWebhookInfo") return ok({ url: "" });
    if (method === "getUpdates") {
      if (++polls === 1) return ok([]);
      if (polls === 2) return ok([message("/help", 1), message("/status", 2), message("first", 3), message("/steer second", 4), message("/stop", 5)]);
    }
    return new Promise<Response>((_, reject) => { init!.signal!.addEventListener("abort", () => reject(new Error("aborted")), { once: true }); });
  }) as typeof fetch;
  const c = new TelegramSessionConnection("placeholder", 42, { canStop: () => true });
  try {
    await c.start(m => { admitted.push(m.text); }, () => { stops++; }, () => new Promise<string>(() => {}), () => false);
    await tick();
    assert.deepEqual(admitted, ["first", "second"]); assert.equal(stops, 1); assert.ok(polls >= 3);
  } finally { await c.stop(); globalThis.fetch = original; }
});

test("typed input and one-use choices admit before held keyboard cleanup and acknowledgements", async () => {
  const original = globalThis.fetch, held = deferred<Response>(); let data = "", admitted = 0;
  globalThis.fetch = (async (url, init) => {
    const body = JSON.parse(String(init?.body));
    if (String(url).endsWith("/sendRichMessage")) { data = body.reply_markup.inline_keyboard[0][0].callback_data; return ok(); }
    return held.promise;
  }) as typeof fetch;
  const c = new TelegramSessionConnection("placeholder", 42);
  try {
    await c.post("Continue?", [{ label: "Yes", reply: "Continue" }]);
    const q = { update_id: 1, callback_query: { id: "q", data, from: { id: 42, is_bot: false }, message: { message_id: 10, chat: { id: 42, type: "private" } } } };
    dispatch(c, q, () => { admitted++; }); dispatch(c, q, () => { admitted++; });
    assert.equal(admitted, 1); assert.equal((c as any).question, undefined);
    dispatch(c, message("typed"), () => { admitted++; });
    assert.equal(admitted, 2);
  } finally { held.resolve(ok(true)); await c.stop(); globalThis.fetch = original; }
});

test("Stop aborts held explicit sends immediately and late results cannot resurrect state", async () => {
  const original = globalThis.fetch;
  try {
    for (const kind of ["draft", "activity", "question"] as const) {
      const held = deferred<Response>(), entered = deferred<void>(); let hold = true, stops = 0;
      globalThis.fetch = (async () => { if (hold) { entered.resolve(); return held.promise; } return ok(); }) as typeof fetch;
      const c = new TelegramSessionConnection("placeholder", 42, { canStop: () => true });
      const sending = kind === "draft" ? c.draft("start", { message: "old" }) : kind === "activity" ? c.activity("working") : c.post("old?", [{ label: "Yes", reply: "old" }]);
      const rejected = assert.rejects(sending, /could not be confirmed/);
      await entered.promise;
      dispatch(c, message("/stop"), undefined, () => { stops++; });
      assert.equal(stops, 1); await rejected;
      hold = false; const newer = await c.draft("start", { message: "new" });
      held.resolve(ok()); await tick();
      assert.equal((c as any).outboundDraft.ref, newer.draftRef);
      assert.equal((c as any).workingStatus, undefined); assert.equal((c as any).question, undefined);
      await c.stop();
    }
  } finally { globalThis.fetch = original; }
});

test("Stop does not borrow authority from visible Working and invalidates UI even if abort throws", async () => {
  const original = globalThis.fetch; globalThis.fetch = (async () => ok()) as typeof fetch;
  const c = new TelegramSessionConnection("placeholder", 42, { canStop: () => false });
  try {
    await c.activity("working"); let aborted = false;
    dispatch(c, message("stop"), undefined, () => { aborted = true; });
    assert.equal(aborted, false); assert.equal((c as any).workingStatus, undefined);
    const eligible = new TelegramSessionConnection("placeholder", 42, { canStop: () => true });
    try {
      await eligible.draft("start", { message: "unfinished" });
      assert.throws(() => dispatch(eligible, message("stop"), undefined, () => { throw new Error("host abort failed"); }));
      assert.equal((eligible as any).outboundDraft, undefined);
    } finally { await eligible.stop(); }
  } finally { await c.stop(); globalThis.fetch = original; }
});

test("download permits ordinary input, rejects extra attachments/buttons, and Stop cancels both eligible operations", async () => {
  const original = globalThis.fetch; let callback = "";
  globalThis.fetch = (async (url, init) => {
    if (String(url).endsWith("/sendRichMessage")) callback = JSON.parse(String(init?.body)).reply_markup.inline_keyboard[0][0].callback_data;
    return ok();
  }) as typeof fetch;
  const c = new TelegramSessionConnection("placeholder", 42, { canStop: () => true });
  const reception = deferred<void>(); const admitted: any[] = []; let stops = 0;
  const input = (m: any) => { admitted.push(m); if (m.attachment) return reception.promise; };
  try {
    await c.post("Choose?", [{ label: "Yes", reply: "Go" }]);
    const file = { ...message("caption"), message: { ...message("caption").message, document: { file_id: "file", file_name: "a.txt" } } };
    dispatch(c, file, input); await tick();
    dispatch(c, { update_id: 2, callback_query: { id: "q", data: callback, from: { id: 42, is_bot: false }, message: { message_id: 10, chat: { id: 42, type: "private" } } } }, input);
    assert.equal(admitted.length, 1); assert.ok((c as any).question);
    dispatch(c, message("ordinary"), input); dispatch(c, file, input);
    assert.equal(admitted.length, 2); assert.equal(admitted[1].text, "ordinary");
    dispatch(c, message("/stop"), input, () => { stops++; });
    assert.equal(stops, 1); assert.equal(admitted[0].downloadSignal.aborted, true);
  } finally { reception.resolve(); await c.stop(); globalThis.fetch = original; }
});

test("update approval acts synchronously before held network acknowledgements", async () => {
  const original = globalThis.fetch, held = deferred<Response>(); let callback = "", acted = 0;
  globalThis.fetch = (async (url, init) => {
    if (String(url).endsWith("/sendMessage")) { callback = JSON.parse(String(init?.body)).reply_markup.inline_keyboard[0][0].callback_data; return ok(); }
    return held.promise;
  }) as typeof fetch;
  const c = new TelegramSessionConnection("placeholder", 42);
  try {
    await c.offerUpdate("Update", "9.0.0", approved => { if (approved) acted++; });
    const q = { update_id: 1, callback_query: { id: "q", data: callback, from: { id: 42, is_bot: false }, message: { message_id: 10, chat: { id: 42, type: "private" } } } };
    dispatch(c, q); dispatch(c, q); assert.equal(acted, 1);
  } finally { held.resolve(ok(true)); await c.stop(); globalThis.fetch = original; }
});

test("typed input invalidates a question already waiting in the outbound queue", async () => {
  const original = globalThis.fetch, held = deferred<Response>(), entered = deferred<void>(); let sends = 0;
  globalThis.fetch = (async () => { sends++; if (sends === 1) { entered.resolve(); return held.promise; } return ok(); }) as typeof fetch;
  const c = new TelegramSessionConnection("placeholder", 42);
  try {
    const first = c.post("first"); await entered.promise;
    const question = c.post("old?", [{ label: "Yes", reply: "old" }]);
    const rejected = assert.rejects(question, /superseded before delivery/);
    dispatch(c, message("new instruction")); held.resolve(ok()); await first; await rejected;
    assert.equal(sends, 1); assert.equal((c as any).question, undefined);
  } finally { held.resolve(ok()); await c.stop(); globalThis.fetch = original; }
});

test("bounded FIFO rejects overload, queue residence and queued cancellation before execution", async () => {
  const queue = new TransportQueue({ depth: 1, residenceMs: 20, totalMs: 1000 });
  const held = deferred<void>(); let ran = 0;
  const first = queue.run(() => held.promise, new AbortController().signal);
  const second = queue.run(async () => { ran++; }, new AbortController().signal);
  const expired = assert.rejects(second, /before delivery/);
  await assert.rejects(queue.run(async () => {}, new AbortController().signal), /queue is full/);
  await expired; assert.equal(ran, 0);
  const controller = new AbortController();
  const cancelled = assert.rejects(queue.run(async () => { ran++; }, controller.signal), /before delivery/);
  controller.abort(); await cancelled; held.resolve(); await first;
  await queue.run(async () => { ran++; }, new AbortController().signal); assert.equal(ran, 1);
});

test("queue total deadline releases a stalled slot without replaying it", async () => {
  const queue = new TransportQueue({ depth: 2, residenceMs: 1000, totalMs: 20 });
  const held = deferred<void>(); let runs = 0;
  const first = queue.run(() => { runs++; return held.promise; }, new AbortController().signal);
  await assert.rejects(first, /timed out/);
  await queue.run(async () => { runs++; }, new AbortController().signal);
  held.resolve(); await tick(); assert.equal(runs, 2);
});

test("a failed input push does not block later same-batch input or expose raw errors", async () => {
  const original = globalThis.fetch; const notices: string[] = [];
  globalThis.fetch = (async (_url, init) => { notices.push(JSON.parse(String(init?.body)).text || ""); return ok(); }) as typeof fetch;
  const c = new TelegramSessionConnection("placeholder", 42); let calls = 0;
  try {
    const input = () => { if (++calls === 1) throw new Error("private host detail"); };
    dispatch(c, message("one"), input); dispatch(c, message("two"), input);
    assert.equal(calls, 2); await tick();
    assert.ok(notices.some(text => text.includes("Could not confirm delivery")));
    assert.ok(!notices.some(text => text.includes("private host detail")));
  } finally { await c.stop(); globalThis.fetch = original; }
});

test("inert disconnect cleanup uses captured message IDs and never persists an unfinished draft", async () => {
  const original = globalThis.fetch; const calls: Array<{ method: string; body: any }> = []; let id = 0;
  globalThis.fetch = (async (url, init) => {
    calls.push({ method: String(url).split("/").at(-1)!, body: JSON.parse(String(init?.body)) });
    return ok({ message_id: ++id });
  }) as typeof fetch;
  const c = new TelegramSessionConnection("placeholder", 42);
  try {
    await c.activity("working"); await c.post("Question?", [{ label: "Yes", reply: "Go" }]);
    await c.draft("start", { message: "unfinished" });
    const working = (c as any).workingStatus.id, question = (c as any).question.messageId;
    const closing = c.stop(); assert.equal(c.stop(), closing); await closing;
    assert.ok(calls.some(c => c.method === "deleteMessage" && c.body.message_id === working));
    assert.ok(calls.some(c => c.method === "editMessageReplyMarkup" && c.body.message_id === question));
    assert.equal(calls.filter(c => c.method === "sendRichMessage").length, 1);
  } finally { await c.stop(); globalThis.fetch = original; }
});

test("body cancellation settles explicit delivery without minting a reference", async () => {
  const original = globalThis.fetch, entered = deferred<void>(), body = deferred<any>();
  globalThis.fetch = (async () => ({ ok: true, json: () => { entered.resolve(); return body.promise; } })) as unknown as typeof fetch;
  const c = new TelegramSessionConnection("placeholder", 42), abort = new AbortController();
  try {
    const posting = c.post("body stall", undefined, abort.signal), rejected = assert.rejects(posting, /could not be confirmed/);
    await entered.promise; abort.abort(); await rejected;
    body.resolve({ ok: true, result: { message_id: 10 } }); await tick();
    assert.equal((c as any).messages.size, 0);
  } finally { await c.stop(); globalThis.fetch = original; }
});

test("disconnect does not report polling completion until noncooperative getUpdates actually ends", async () => {
  const original = globalThis.fetch, poll = deferred<Response>(), entered = deferred<void>(); let n = 0, closed = false;
  globalThis.fetch = (async url => {
    if (String(url).endsWith("/getWebhookInfo")) return ok({ url: "" });
    if (++n === 1) return ok([]);
    entered.resolve(); return poll.promise;
  }) as typeof fetch;
  const c = new TelegramSessionConnection("placeholder", 42);
  try {
    await c.start(() => {}, () => {}, () => "", () => false); await entered.promise;
    const closing = c.stop().then(() => { closed = true; }); await tick();
    assert.equal(closed, false); poll.resolve(ok([])); await closing; assert.equal(closed, true);
  } finally { poll.resolve(ok([])); await c.stop(); globalThis.fetch = original; }
});
