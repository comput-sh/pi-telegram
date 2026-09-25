import assert from "node:assert/strict";
import test from "node:test";
import { TelegramSessionConnection } from "../src/telegram.ts";

async function fixture(work: (connection: TelegramSessionConnection, calls: Array<{ method: string; body: any }>) => Promise<void>) {
  const original = globalThis.fetch, calls: Array<{ method: string; body: any }> = [];
  globalThis.fetch = (async (url, init) => {
    calls.push({ method: String(url).split("/").at(-1)!, body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify({ ok: true, result: { message_id: calls.length } }));
  }) as typeof fetch;
  const connection = new TelegramSessionConnection("test-placeholder", 42);
  try { await work(connection, calls); } finally { await connection.stop(); globalThis.fetch = original; }
}

test("explicit draft replacement uses one plain preview and finalizes exactly once", async () => fixture(async (connection, calls) => {
  const { draftRef } = await connection.draft("start", { message: "Hello" });
  assert.ok(draftRef);
  await connection.draft("update", { draftRef, message: "Entirely different full snapshot" });
  const drafts = calls.filter(c => c.method === "sendMessageDraft");
  assert.equal(drafts.length, 2);
  assert.equal(drafts[0].body.draft_id, drafts[1].body.draft_id);
  assert.equal(calls.filter(c => c.method === "sendRichMessage").length, 0);
  assert.ok(!calls.some(c => c.method === "sendMessage")); // No implicit activity.
  const { messageRef } = await connection.draft("finalize", { draftRef, message: "# Final" });
  assert.ok(messageRef); assert.notEqual(messageRef, draftRef);
  assert.deepEqual(calls.filter(c => c.method === "sendRichMessage").map(c => c.body.rich_message.markdown), ["# Final"]);
  await assert.rejects(connection.draft("finalize", { draftRef }), /expired draft/);
  await connection.edit(messageRef, "# Corrected");
  assert.equal(calls.at(-1)!.method, "editMessageText");
  assert.deepEqual(calls.at(-1)!.body.rich_message, { markdown: "# Corrected" });
}));

test("post and independent activity never finalize or discard a draft", async () => fixture(async (connection, calls) => {
  const { draftRef } = await connection.draft("start", { message: "Unfinished" });
  await connection.post("Saved milestone"); await connection.activity("working"); await connection.activity("clear");
  await connection.draft("update", { draftRef, message: "Replacement" });
  await connection.draft("discard", { draftRef });
  assert.deepEqual(calls.filter(c => c.method === "sendRichMessage").map(c => c.body.rich_message.markdown), ["Saved milestone"]);
  await assert.rejects(connection.draft("update", { draftRef, message: "late" }), /expired draft/);
  await connection.draft("start", { message: "Another unfinished draft" });
  await connection.stop();
  assert.equal(calls.filter(c => c.method === "sendRichMessage").length, 1);
}));

test("draft references and actions are explicit and connection scoped", async () => fixture(async (connection) => {
  const { draftRef } = await connection.draft("start", { message: "one" });
  await assert.rejects(connection.draft("start", { message: "two" }), /already active/);
  await assert.rejects(connection.draft("update", { message: "two" }), /draftRef/);
  await assert.rejects(connection.draft("update", { draftRef }), /full message/);
  await assert.rejects(connection.draft("discard", { draftRef, message: "two" }), /does not accept/);
  const other = new TelegramSessionConnection("other-placeholder", 42);
  try { await assert.rejects(other.draft("finalize", { draftRef }), /expired draft/); }
  finally { await other.stop(); }
}));

test("plain previews truncate surrogate-safely while rich finals retain full text", async () => fixture(async (connection, calls) => {
  const text = "**Heading**\n" + "😀".repeat(2200);
  const { draftRef } = await connection.draft("start", { message: text });
  await connection.draft("update", { draftRef, message: text + "\nMore" });
  for (const draft of calls.filter(c => c.method === "sendMessageDraft")) {
    assert.ok(draft.body.text.length <= 4096); assert.ok(draft.body.text.includes("[Preview truncated]"));
    assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(draft.body.text));
  }
  await connection.draft("finalize", { draftRef });
  assert.deepEqual(calls.filter(c => c.method === "sendRichMessage").map(c => c.body.rich_message.markdown), [text + "\nMore"]);
}));

test("uncertain final delivery retires intent and is never replayed", async () => fixture(async (connection, calls) => {
  const { draftRef } = await connection.draft("start", { message: "Draft" });
  const original = globalThis.fetch;
  globalThis.fetch = (async (url, init) => { if (String(url).endsWith("/sendRichMessage")) throw new Error("offline"); return original(url, init); }) as typeof fetch;
  await assert.rejects(connection.draft("finalize", { draftRef }), /could not be confirmed/);
  globalThis.fetch = original;
  await assert.rejects(connection.draft("finalize", { draftRef }), /expired draft/);
  assert.equal(calls.filter(c => c.method === "sendRichMessage").length, 0);
}));
