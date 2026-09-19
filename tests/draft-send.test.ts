import assert from "node:assert/strict";
import test from "node:test";
import { TelegramSessionConnection } from "../src/telegram.ts";

async function fixture(work: (connection: TelegramSessionConnection, calls: Array<{ method: string; body: any }>) => Promise<void>) {
  const original = globalThis.fetch;
  const calls: Array<{ method: string; body: any }> = [];
  globalThis.fetch = (async (url, init) => {
    calls.push({ method: String(url).split("/").at(-1)!, body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify({ ok: true, result: { message_id: calls.length } }));
  }) as typeof fetch;
  const connection = new TelegramSessionConnection("test-placeholder", 42);
  try { await work(connection, calls); }
  finally { await connection.stop(); globalThis.fetch = original; }
}

test("prefix snapshots share a draft; omission finalizes the full answer, not each snapshot", async () => fixture(async (connection, calls) => {
  await connection.sendOutbound("Hello", "working");
  await connection.sendOutbound("Hello there", "working");
  await connection.sendOutbound("Hello there", "working");
  const drafts = calls.filter(c => c.method === "sendRichMessageDraft");
  assert.equal(drafts.length, 2);
  assert.equal(drafts[0].body.draft_id, drafts[1].body.draft_id);
  assert.equal(calls.filter(c => c.method === "sendRichMessage").length, 0);
  await connection.sendOutbound("Hello there! Final.");
  assert.deepEqual(calls.filter(c => c.method === "sendRichMessage").map(c => c.body.rich_message.markdown), ["Hello there! Final."]);
  assert.equal((connection as any).outboundDraft, undefined);
  await connection.sendOutbound("Hello there! Final. Another answer", "working");
  assert.notEqual(calls.filter(c => c.method === "sendRichMessageDraft").at(-1)!.body.draft_id, drafts[0].body.draft_id);
}));

test("different text persists the previous draft; status-only working retains it and empty call finalizes", async () => fixture(async (connection, calls) => {
  await connection.sendOutbound("First", "working");
  await connection.sendOutbound(undefined, "working");
  assert.equal(calls.filter(c => c.method === "sendRichMessage").length, 0);
  await connection.sendOutbound("Second", "working");
  const drafts = calls.filter(c => c.method === "sendRichMessageDraft");
  assert.notEqual(drafts[0].body.draft_id, drafts[1].body.draft_id);
  await connection.sendOutbound();
  await connection.sendOutbound();
  assert.deepEqual(calls.filter(c => c.method === "sendRichMessage").map(c => c.body.rich_message.markdown), ["First", "Second"]);
}));

test("buttons persist an extended draft exactly once; shutdown never publishes pending text", async () => fixture(async (connection, calls) => {
  await connection.sendOutbound("Apply", "working");
  await connection.sendOutbound("Apply changes?", "working", [{ label: "Yes", reply: "Apply changes" }]);
  assert.equal((connection as any).outboundDraft, undefined);
  const persisted = calls.filter(c => c.method === "sendRichMessage");
  assert.equal(persisted.length, 1);
  assert.ok(persisted[0].body.reply_markup);
  await connection.sendOutbound("Unfinished", "working");
  await connection.stop();
  assert.equal((connection as any).outboundDraft, undefined);
  assert.equal(calls.filter(c => c.method === "sendRichMessage").length, 1);
}));

test("uncertain final delivery is not replayed by a later empty call", async () => fixture(async (connection, calls) => {
  await connection.sendOutbound("Draft", "working");
  const original = globalThis.fetch;
  globalThis.fetch = (async (url, init) => {
    if (String(url).endsWith("/sendRichMessage")) throw new Error("offline");
    return original(url, init);
  }) as typeof fetch;
  await assert.rejects(connection.sendOutbound(), /could not be confirmed/);
  globalThis.fetch = original;
  await connection.sendOutbound();
  assert.equal(calls.filter(c => c.method === "sendRichMessage").length, 0);
}));
