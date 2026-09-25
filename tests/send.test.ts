import assert from "node:assert/strict";
import test from "node:test";
import { TelegramSessionConnection } from "../src/telegram.ts";

test("persistent posts, activity and edit refs are explicit independent actions", async () => {
  const original = globalThis.fetch, calls: Array<{ method: string; body: any }> = [];
  globalThis.fetch = (async (url, init) => {
    calls.push({ method: String(url).split("/").at(-1)!, body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify({ ok: true, result: { message_id: calls.length } }));
  }) as typeof fetch;
  const connection = new TelegramSessionConnection("placeholder", 42);
  try {
    const { messageRef } = await connection.post("Acknowledged");
    assert.ok(messageRef); assert.ok(!messageRef.includes("placeholder"));
    assert.equal(calls[0].method, "sendRichMessage");
    await connection.activity("working");
    const working = (connection as any).workingStatus;
    await connection.post("Milestone"); await connection.edit(messageRef, "Corrected acknowledgement");
    assert.equal((connection as any).workingStatus, working);
    await connection.activity("working");
    assert.equal(calls.filter(c => c.method === "sendMessage").length, 1); // Refresh does not reorder Working.
    const button = await connection.post("Apply?", [{ label: "Yes", reply: "Apply changes" }]);
    await assert.rejects(connection.edit(button.messageRef, "Changed question"), /button-bearing/);
    await assert.rejects(connection.edit("42", "Unknown"), /Unknown/);
    await connection.activity("clear");
    assert.equal((connection as any).workingStatus, undefined);
    await assert.rejects(connection.post(" "), /blank/);
    await assert.rejects(connection.activity("idle" as any), /working or clear/);
    await assert.rejects(connection.post("cancelled", undefined, AbortSignal.abort()));
  } finally { await connection.stop(); globalThis.fetch = original; }
});

test("ordered explicit deliveries never infer prefix identity", async () => {
  const original = globalThis.fetch, texts: string[] = [];
  globalThis.fetch = (async (url, init) => {
    const body = JSON.parse(String(init?.body));
    if (String(url).endsWith("/sendRichMessage")) texts.push(body.rich_message.markdown);
    return new Response(JSON.stringify({ ok: true, result: { message_id: texts.length } }));
  }) as typeof fetch;
  const connection = new TelegramSessionConnection("placeholder", 42);
  try {
    await Promise.all([connection.post("one"), connection.post("one extended")]);
    assert.deepEqual(texts, ["one", "one extended"]);
    await connection.stop(); await assert.rejects(connection.post("late"));
  } finally { await connection.stop(); globalThis.fetch = original; }
});

test("failed activity deletion can be retried explicitly without deleting newer status", async () => {
  const original = globalThis.fetch, deleted: number[] = []; let next = 0, fail = true;
  globalThis.fetch = (async (url, init) => {
    const body = JSON.parse(String(init?.body));
    if (String(url).endsWith("/deleteMessage")) { deleted.push(body.message_id); if (fail) throw new Error("offline"); }
    return new Response(JSON.stringify({ ok: true, result: { message_id: ++next } }));
  }) as typeof fetch;
  const connection = new TelegramSessionConnection("placeholder", 42);
  try {
    await connection.activity("working");
    await assert.rejects(connection.activity("clear"), /could not be confirmed/);
    fail = false;
    await connection.activity("clear");
    assert.deepEqual(deleted, [1, 1]);
    await connection.activity("working");
    await connection.stop();
    assert.equal(deleted.length, 3); assert.notEqual(deleted[2], 1);
  } finally { await connection.stop(); globalThis.fetch = original; }
});

test("lost successful status deletion is idempotent and cannot strand newer Working", async () => {
  const original = globalThis.fetch, live = new Set<number>(), deleted: number[] = []; let next = 0, loseResponse = true;
  globalThis.fetch = (async (url, init) => {
    const method = String(url).split("/").at(-1), body = JSON.parse(String(init?.body));
    if (method === "sendMessage") { live.add(++next); return new Response(JSON.stringify({ ok: true, result: { message_id: next } })); }
    assert.equal(method, "deleteMessage"); deleted.push(body.message_id);
    if (!live.delete(body.message_id)) return new Response(JSON.stringify({ ok: false, error_code: 400, description: "Bad Request: message to delete not found" }), { status: 400 });
    if (loseResponse) { loseResponse = false; throw new Error("response lost after remote deletion"); }
    return new Response(JSON.stringify({ ok: true, result: true }));
  }) as typeof fetch;
  const connection = new TelegramSessionConnection("placeholder", 42);
  try {
    await connection.activity("working");
    await assert.rejects(connection.activity("clear"), /could not be confirmed/);
    assert.deepEqual([...live], []);
    await connection.activity("working"); assert.deepEqual([...live], [2]);
    await connection.activity("clear");
    assert.deepEqual(deleted, [1, 1, 2]); assert.equal(live.size, 0);
    assert.equal((connection as any).statusCleanup.size, 0);
    assert.equal((connection as any).workingStatus, undefined);
  } finally { await connection.stop(); globalThis.fetch = original; }
});

test("non-missing status failures remain retryable without blocking newer captured IDs", async () => {
  const original = globalThis.fetch;
  try {
    for (const failure of [
      { error_code: 403, description: "Forbidden: bot was blocked by the user" },
      { error_code: 400, description: "Bad Request: chat not found" },
      { error_code: 403, description: "Bad Request: message to delete not found" },
    ]) {
      let next = 0; const deleted: number[] = [];
      globalThis.fetch = (async (url, init) => {
        const method = String(url).split("/").at(-1), body = JSON.parse(String(init?.body));
        if (method === "sendMessage") return new Response(JSON.stringify({ ok: true, result: { message_id: ++next } }));
        deleted.push(body.message_id);
        if (body.message_id === 1) return new Response(JSON.stringify({ ok: false, ...failure }), { status: failure.error_code });
        return new Response(JSON.stringify({ ok: true, result: true }));
      }) as typeof fetch;
      const connection = new TelegramSessionConnection("placeholder", 42);
      try {
        await connection.activity("working"); await assert.rejects(connection.activity("clear"), /could not be confirmed/);
        await connection.activity("working"); await assert.rejects(connection.activity("clear"), /could not be confirmed/);
        assert.deepEqual(deleted, [1, 1, 2]);
        assert.deepEqual([...(connection as any).statusCleanup], [1]);
        await connection.activity("working");
        assert.equal((connection as any).workingStatus.id, 3);
      } finally { await connection.stop(); }
    }
  } finally { globalThis.fetch = original; }
});
