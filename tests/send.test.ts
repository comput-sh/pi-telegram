import assert from "node:assert/strict";
import test from "node:test";
import { TelegramSessionConnection } from "../src/telegram.ts";

test("explicit send supports message, status and buttons; omitted status deletes Working", async () => {
  const oldFetch = globalThis.fetch;
  const calls: Array<{ method: string; body: any }> = [];
  let id = 0;
  globalThis.fetch = (async (url, init) => {
    calls.push({ method: String(url).split("/").at(-1)!, body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify({ ok: true, result: { message_id: ++id } }));
  }) as typeof fetch;
  const connection = new TelegramSessionConnection("test-token", 42);
  try {
    await connection.sendOutbound(undefined, "working");
    assert.equal(calls.at(-1)?.method, "sendMessage");
    assert.equal(calls.at(-1)?.body.text, "Working…");
    const workingId = (connection as any).workingStatus.id;
    await connection.sendOutbound("**Done**");
    assert.ok(calls.some(call => call.method === "deleteMessage" && call.body.message_id === workingId));
    assert.equal(calls.at(-1)?.body.rich_message.markdown, "**Done**");
    assert.equal((connection as any).workingStatus, undefined);
    await connection.sendOutbound("Checking…", "working");
    assert.equal(calls.at(-1)?.body.text, "Working…");
    await connection.sendOutbound("Apply?", undefined, [{ label: "Yes", reply: "Apply the changes" }]);
    assert.equal((connection as any).workingStatus, undefined);
    assert.equal(calls.at(-1)?.method, "sendRichMessage");
    assert.equal(calls.at(-1)?.body.reply_markup.inline_keyboard[0][0].text, "Yes");
    assert.ok((connection as any).question);
    await connection.sendOutbound(undefined, "working");
    await connection.sendOutbound();
    assert.equal((connection as any).workingStatus, undefined);
    assert.ok(!JSON.stringify(calls).includes("Idle"));
    await assert.rejects(connection.sendOutbound(undefined, undefined, [{ label: "Yes", reply: "Yes" }]), /require a message/);
    await assert.rejects(connection.sendOutbound(" "), /blank/);
    await assert.rejects(connection.sendOutbound("text", "idle" as any), /Supported status/);
    const before = calls.length;
    await assert.rejects(connection.sendOutbound("cancelled", undefined, undefined, AbortSignal.abort()));
    assert.equal(calls.length, before);
  } finally { await connection.stop(); globalThis.fetch = oldFetch; }
});

test("concurrent explicit sends are ordered and stop deletes the status", async () => {
  const oldFetch = globalThis.fetch;
  const texts: string[] = [];
  let deletes = 0;
  globalThis.fetch = (async (url, init) => {
    const body = JSON.parse(String(init?.body));
    if (String(url).endsWith("/sendRichMessage")) texts.push(body.rich_message.markdown);
    if (String(url).endsWith("/deleteMessage")) deletes++;
    return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }));
  }) as typeof fetch;
  const connection = new TelegramSessionConnection("test-token", 42);
  try {
    await Promise.all([connection.sendOutbound("one", "working"), connection.sendOutbound("two")]);
    assert.deepEqual(texts, ["one", "two"]);
    assert.equal((connection as any).workingStatus, undefined);
    await connection.sendOutbound(undefined, "working");
    await connection.stop();
    assert.ok(deletes >= 2);
    await assert.rejects(connection.sendOutbound("late"));
  } finally { await connection.stop(); globalThis.fetch = oldFetch; }
});
