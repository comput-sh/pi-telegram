import assert from "node:assert/strict";
import test from "node:test";
import { TelegramSessionConnection } from "../src/telegram.ts";
import type { EmbeddedContent } from "../src/rich-content.ts";

type Request = { method: string; body: any };
const content = (): EmbeddedContent => [
  { type: "paragraph", parts: [{ type: "text", text: "Choose " }, { type: "button", label: "🔎 Review", reply: "Review the plan" }, { type: "text", text: " first." }] },
  { type: "button_row", buttons: [{ label: "Continue", reply: "Continue with the plan" }] },
];
const turn = () => new Promise<void>(resolve => setImmediate(resolve));
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; };
function buttons(rich: any): any[] {
  return rich.blocks.flatMap((block: any) => block.type === "buttons" ? block.buttons : block.text.filter((part: any) => typeof part !== "string").map((part: any) => part.button));
}
function query(id: number, data: string): any {
  return { id: "callback", from: { id: 42, is_bot: false }, message: { message_id: id, chat: { id: 42, type: "private" } }, data };
}
async function fixture(run: (connection: TelegramSessionConnection, requests: Request[], setHook: (hook: (request: Request) => Promise<void>) => void) => Promise<void>): Promise<void> {
  const original = globalThis.fetch;
  const requests: Request[] = [];
  let hook = async (_request: Request) => {};
  let nextId = 0;
  const connection = new TelegramSessionConnection("test-token", 42, { canStop: () => true });
  globalThis.fetch = (async (url, init) => {
    const request = { method: String(url).split("/").at(-1)!, body: JSON.parse(String(init?.body)) };
    requests.push(request);
    const result = request.method === "sendRichMessage" ? { message_id: ++nextId } : true;
    await hook(request);
    return new Response(JSON.stringify({ ok: true, result }));
  }) as typeof fetch;
  try { await run(connection, requests, value => { hook = value; }); }
  finally { await connection.stop(); globalThis.fetch = original; }
}
function dispatch(connection: TelegramSessionConnection, text: string, onMessage: (message: any) => void = () => {}): void {
  (connection as any).dispatch({ update_id: 1, message: { message_id: 50, chat: { id: 42, type: "private" }, from: { id: 42, is_bot: false }, text } }, onMessage, () => {}, () => "status", () => false);
}

test("embedded controls mint opaque ASCII callbacks, reject wrong identities/replay and disable every action", async () => fixture(async (connection, requests) => {
  const sent = await connection.postEmbedded(content());
  const payload = requests[0]!.body;
  assert.equal(payload.reply_markup, undefined);
  assert.equal(payload.rich_message.markdown, undefined);
  const actions = buttons(payload.rich_message);
  assert.equal(actions.length, 2);
  assert.match(actions[0].callback_data, /^ask:[a-f0-9]{24}:0$/);
  assert.match(actions[1].callback_data, /^ask:[a-f0-9]{24}:1$/);
  for (const action of actions) assert.ok(Buffer.byteLength(action.callback_data, "utf8") <= 64);
  assert.ok(!JSON.stringify(sent).includes(actions[0].callback_data));
  await assert.rejects(connection.edit(sent.messageRef, "Changed"), /button-bearing/);
  const received: any[] = [];
  const click = (value: any) => (connection as any).handleQuestionButton(value, (message: any) => received.push(message));
  const valid = query(1, actions[0].callback_data);
  for (const invalid of [
    { ...valid, from: { id: 7, is_bot: false } }, { ...valid, from: { id: 42, is_bot: true } },
    { ...valid, message: { message_id: 1, chat: { id: 7, type: "private" } } },
    { ...valid, message: { message_id: 1, chat: { id: 42, type: "group" } } },
    { ...valid, message: undefined }, query(999, actions[0].callback_data),
    query(1, "ask:forged:0"), query(1, actions[0].callback_data.replace(/:0$/, ":8")),
    query(1, actions[0].callback_data + ":extra"), { ...valid, data: undefined },
  ]) click(invalid);
  assert.equal(received.length, 0);
  click(valid); click(valid);
  assert.equal(received.length, 1);
  assert.equal(received[0].forceFollowUp, true);
  assert.match(received[0].text, /Choose 🔎 Review first/);
  assert.match(received[0].text, /Review the plan/);
  assert.equal((connection as any).question, undefined);
  await turn();
  const cleanup = requests.find(r => r.method === "editMessageText")!;
  assert.equal(cleanup.body.message_id, 1);
  assert.deepEqual(cleanup.body.reply_markup, { inline_keyboard: [] });
  assert.ok(buttons(cleanup.body.rich_message).every(button => "disabled" in button && !("callback_data" in button)));
  assert.equal(cleanup.body.rich_message.blocks[0].text[0], "Choose ");
}));

test("embedded content validates before replacing a pending question or making I/O", async () => fixture(async (connection, requests) => {
  await connection.post("Original", [{ label: "Yes", reply: "Yes" }]);
  const pending = (connection as any).question;
  const count = requests.length;
  await assert.rejects(connection.postEmbedded([{ type: "button_row", buttons: [{ label: "Yes", reply: "yes", callback_data: "ask:raw:0" }] }] as any), /unsupported/);
  assert.equal((connection as any).question, pending);
  assert.equal(requests.length, count);
}));

test("both layouts share one question slot and cleanup targets only captured older content", async () => fixture(async (connection, requests, setHook) => {
  const held = deferred();
  await connection.postEmbedded(content());
  const old = buttons(requests[0]!.body.rich_message)[0].callback_data;
  setHook(async request => { if (request.method === "editMessageText") await held.promise; });
  await connection.post("Keyboard", [{ label: "Yes", reply: "yes" }]);
  let received = 0;
  (connection as any).handleQuestionButton(query(1, old), () => { received++; });
  assert.equal(received, 0);
  await connection.postEmbedded(content());
  assert.equal((connection as any).question.messageId, 3);
  held.resolve(); await turn();
  assert.ok(requests.some(r => r.method === "editMessageText" && r.body.message_id === 1));
  assert.ok(requests.some(r => r.method === "editMessageReplyMarkup" && r.body.message_id === 2));
  assert.ok(!requests.some(r => r.method === "editMessageText" && r.body.message_id === 3));
}));

test("typed input, Stop and disconnect revoke embedded authority and use rich disabled cleanup", async () => {
  for (const reason of ["typed", "stop", "disconnect"]) await fixture(async (connection, requests) => {
    await connection.postEmbedded(content());
    const data = buttons(requests[0]!.body.rich_message)[0].callback_data;
    if (reason === "disconnect") await connection.stop();
    else dispatch(connection, reason === "typed" ? "My typed answer" : "stop");
    assert.equal((connection as any).question, undefined);
    let received = 0;
    (connection as any).handleQuestionButton(query(1, data), () => { received++; });
    assert.equal(received, 0);
    await turn();
    const cleanup = requests.find(r => r.method === "editMessageText")!;
    assert.equal(cleanup.body.message_id, 1);
    assert.ok(buttons(cleanup.body.rich_message).every(button => "disabled" in button && !("callback_data" in button)));
  });
});

test("content is snapshotted before queueing and caller mutation cannot change public text or selected reply", async () => fixture(async (connection, requests, setHook) => {
  const held = deferred(), entered = deferred();
  setHook(async request => { if (request.method === "sendRichMessage" && request.body.rich_message.markdown === "Holding") { entered.resolve(); await held.promise; } });
  const holding = connection.post("Holding");
  await entered.promise;
  const input = content();
  const posting = connection.postEmbedded(input);
  (input[0] as any).parts[0].text = "Replaced";
  (input[0] as any).parts[1].reply = "Malicious replacement";
  (input[1] as any).buttons.push({ label: "Injected", reply: "injected" });
  held.resolve(); await holding; await posting;
  const payload = requests.filter(r => r.method === "sendRichMessage")[1]!.body.rich_message;
  assert.equal(payload.blocks[0].text[0], "Choose ");
  assert.equal(buttons(payload).length, 2);
  let text = "";
  (connection as any).handleQuestionButton(query(2, buttons(payload)[0].callback_data), (message: any) => { text = message.text; });
  assert.match(text, /Review the plan/);
  assert.ok(!text.includes("replacement"));
}));

test("typed answer during held send prevents activation and disables the known late result", async () => fixture(async (connection, requests, setHook) => {
  const held = deferred(), entered = deferred();
  setHook(async request => { if (request.method === "sendRichMessage") { entered.resolve(); await held.promise; } });
  const posting = connection.postEmbedded(content());
  const rejected = assert.rejects(posting);
  await entered.promise;
  dispatch(connection, "Already answered");
  held.resolve(); await rejected; await turn();
  assert.equal((connection as any).question, undefined);
  assert.ok(requests.some(r => r.method === "editMessageText" && r.body.message_id === 1));
  assert.equal(requests.filter(r => r.method === "sendRichMessage").length, 1);
}));

test("Stop/disconnect during uncertain send cannot activate or replay embedded controls", async () => {
  for (const disconnect of [false, true]) await fixture(async (connection, requests, setHook) => {
    const held = deferred(), entered = deferred();
    setHook(async request => { if (request.method === "sendRichMessage") { entered.resolve(); await held.promise; } });
    const posting = connection.postEmbedded(content());
    const rejected = assert.rejects(posting);
    await entered.promise;
    if (disconnect) await connection.stop(); else dispatch(connection, "stop");
    await rejected;
    held.resolve(); await turn();
    assert.equal((connection as any).question, undefined);
    assert.equal((connection as any).messages.size, 0);
    assert.equal(requests.filter(r => r.method === "sendRichMessage").length, 1);
  });
});

test("expired and file-download-blocked embedded choices never bypass existing admission rules", async () => fixture(async (connection, requests) => {
  await connection.postEmbedded(content());
  const value = query(1, buttons(requests[0]!.body.rich_message)[0].callback_data);
  let received = 0;
  (connection as any).incoming = {};
  (connection as any).handleQuestionButton(value, () => { received++; });
  assert.equal(received, 0);
  assert.ok((connection as any).question);
  (connection as any).incoming = undefined;
  (connection as any).question.expires = 0;
  (connection as any).handleQuestionButton(value, () => { received++; });
  assert.equal(received, 0);
  (connection as any).expireQuestion();
  await turn();
  assert.ok(requests.some(r => r.method === "editMessageText"));
}));

test("queued embedded question is cancelled before sending when newer input invalidates its generation", async () => fixture(async (connection, requests, setHook) => {
  const held = deferred(), entered = deferred();
  setHook(async request => { if (request.method === "sendRichMessage") { entered.resolve(); await held.promise; } });
  const holding = connection.post("Holding");
  await entered.promise;
  const posting = connection.postEmbedded(content());
  const rejected = assert.rejects(posting, /not sent/);
  dispatch(connection, "New direction");
  held.resolve(); await holding; await rejected;
  assert.equal(requests.filter(r => r.method === "sendRichMessage").length, 1);
  assert.equal((connection as any).question, undefined);
}));

test("embedded expiry timer retires callbacks and schedules disabled content without input", async t => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  await fixture(async (connection, requests) => {
    await connection.postEmbedded(content());
    t.mock.timers.tick(15 * 60_000);
    assert.equal((connection as any).question, undefined);
    await turn();
    const cleanup = requests.find(r => r.method === "editMessageText")!;
    assert.equal(cleanup.body.message_id, 1);
    assert.ok(buttons(cleanup.body.rich_message).every(button => "disabled" in button));
  });
});

test("unknown send failure installs no question or message reference and is never retried", async () => fixture(async (connection, requests, setHook) => {
  setHook(async request => { if (request.method === "sendRichMessage") throw new Error("Simulated lost response"); });
  await assert.rejects(connection.postEmbedded(content()));
  await turn();
  assert.equal((connection as any).question, undefined);
  assert.equal((connection as any).messages.size, 0);
  assert.equal(requests.filter(r => r.method === "sendRichMessage").length, 1);
}));

test("malformed returned message IDs cannot install an authoritative embedded question", async () => {
  const original = globalThis.fetch;
  const connection = new TelegramSessionConnection("test-token", 42);
  try {
    for (const messageId of [0, -1, "10", undefined]) {
      globalThis.fetch = (async () => new Response(JSON.stringify({ ok: true, result: { message_id: messageId } }))) as typeof fetch;
      await assert.rejects(connection.postEmbedded(content()), /could not be confirmed/);
      assert.equal((connection as any).question, undefined);
      assert.equal((connection as any).messages.size, 0);
    }
  } finally { await connection.stop(); globalThis.fetch = original; }
});

test("failed cleanup cannot revive embedded authority or cause primary post replay", async () => fixture(async (connection, requests, setHook) => {
  await connection.postEmbedded(content());
  const value = query(1, buttons(requests[0]!.body.rich_message)[0].callback_data);
  setHook(async request => { if (request.method === "editMessageText") throw new Error("Simulated unknown cleanup"); });
  let received = 0;
  (connection as any).handleQuestionButton(value, () => { received++; });
  await turn();
  (connection as any).handleQuestionButton(value, () => { received++; });
  assert.equal(received, 1);
  assert.equal(requests.filter(r => r.method === "sendRichMessage").length, 1);
  assert.equal((connection as any).question, undefined);
}));
