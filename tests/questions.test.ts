import assert from "node:assert/strict";
import test from "node:test";
import { TelegramSessionConnection } from "../src/telegram.ts";

test("typed answers or disconnects during a slow send cannot revive stale buttons", async () => {
  const original = globalThis.fetch;
  try {
    for (const disconnect of [false, true]) {
      const connection = new TelegramSessionConnection("test-token", 42);
      let finish!: () => void;
      let entered!: () => void;
      const started = new Promise<void>(resolve => { entered = resolve; });
      const pending = new Promise<void>(resolve => { finish = resolve; });
      globalThis.fetch = (async (url) => {
        if (String(url).endsWith("/sendRichMessage")) { entered(); await pending; }
        return new Response(JSON.stringify({ ok: true, result: { message_id: 10 } }));
      }) as typeof fetch;
      const question = connection.post("Continue?", [{ label: "Yes", reply: "Continue" }]);
      const rejected = assert.rejects(question, /could not be confirmed/);
      await started;
      if (disconnect) await connection.stop();
      else await (connection as any).expireQuestion();
      finish();
      await rejected;
      assert.equal((connection as any).question, undefined);
      await connection.stop();
    }
  } finally { globalThis.fetch = original; }
});

test("failed answer routing reports uncertainty without replaying the choice", async () => {
  const original = globalThis.fetch;
  const requests: any[] = [];
  const connection = new TelegramSessionConnection("test-token", 42);
  globalThis.fetch = (async (url, init) => {
    requests.push({ method: String(url).split("/").at(-1), body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify({ ok: true, result: { message_id: 10 } }));
  }) as typeof fetch;
  try {
    await connection.post("Continue?", [{ label: "Yes", reply: "Continue" }]);
    const data = requests[0].body.reply_markup.inline_keyboard[0][0].callback_data;
    const query = { id: "q", data, from: { id: 42, is_bot: false }, message: { message_id: 10, chat: { id: 42, type: "private" } } };
    let calls = 0;
    const route = async () => { calls++; throw new Error("private error not for Telegram"); };
    await (connection as any).handleQuestionButton(query, route);
    await (connection as any).handleQuestionButton(query, route);
    assert.equal(calls, 1);
    await new Promise(resolve => setImmediate(resolve)); // Notice is independent of admission.
    assert.ok(requests.some(r => r.method === "sendMessage" && r.body.text.includes("Could not confirm delivery")));
    assert.ok(!JSON.stringify(requests).includes("private error"));
  } finally { await connection.stop(); globalThis.fetch = original; }
});

test("questions use Rich Markdown and one-use owner-bound buttons", async () => {
  const original = globalThis.fetch;
  const requests: any[] = [];
  let messageId = 0;
  globalThis.fetch = (async (url, init) => {
    const method = String(url).split("/").at(-1);
    const body = JSON.parse(String(init?.body));
    requests.push({ method, body });
    return new Response(JSON.stringify({ ok: true, result: method === "sendRichMessage" ? { message_id: ++messageId } : true }));
  }) as typeof fetch;
  const connection = new TelegramSessionConnection("test-token", 42);
  const answers: any[] = [];
  const click = (query: any) => (connection as any).handleQuestionButton(query, (message: any) => { answers.push(message); });
  try {
    await assert.rejects(connection.post("?", []), /1–8/);
    await assert.rejects(connection.post("?", [{ label: "Yes", reply: "one" }, { label: " yes ", reply: "two" }]), /distinct/);
    await connection.post("**Implement?**", [{ label: "Yes", reply: "Implement the proposal" }, { label: "Discuss", reply: "!discuss first" }]);
    const sent = requests.find(r => r.method === "sendRichMessage");
    assert.equal(sent.body.rich_message.markdown, "**Implement?**");
    const rows = sent.body.reply_markup.inline_keyboard;
    assert.equal(rows.length, 2);
    assert.ok(Buffer.byteLength(rows[0][0].callback_data) <= 64);
    const base = { id: "query", from: { id: 42, is_bot: false }, message: { message_id: 1, chat: { id: 42, type: "private" } }, data: rows[1][0].callback_data };
    await click({ ...base, from: { id: 99, is_bot: false } });
    await click({ ...base, message: { ...base.message, chat: { id: 42, type: "group" } } });
    await click({ ...base, message: { ...base.message, message_id: 99 } });
    await click({ ...base, data: "ask:forged:0" });
    assert.equal(answers.length, 0);
    await Promise.all([click(base), click(base)]);
    assert.equal(answers.length, 1);
    assert.equal(answers[0].forceFollowUp, true);
    assert.match(answers[0].text, /Implement\?/);
    assert.match(answers[0].text, /!discuss first/);
    assert.ok(requests.some(r => r.method === "editMessageReplyMarkup" && r.body.reply_markup.inline_keyboard.length === 0));
    await connection.post("Again?", [{ label: "No", reply: "No" }]);
    await click(base);
    assert.equal(answers.length, 1);
    const current = requests.filter(r => r.method === "sendRichMessage").at(-1);
    (connection as any).question.expires = 0;
    await click({ ...base, message: { ...base.message, message_id: 2 }, data: current.body.reply_markup.inline_keyboard[0][0].callback_data });
    assert.equal(answers.length, 1);
    await connection.post("Last?", [{ label: "Yes", reply: "Yes" }]);
    await (connection as any).expireQuestion();
    assert.equal((connection as any).question, undefined);
    await connection.stop();
  } finally { await connection.stop(); globalThis.fetch = original; }
});
