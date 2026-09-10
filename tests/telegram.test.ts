import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  parseTelegramBotCommand,
  TelegramSessionConnection,
} from "../src/telegram.ts";

test("parseTelegramBotCommand recognizes private-chat command forms", () => {
  assert.deepEqual(parseTelegramBotCommand("/status"), { name: "status" });
  assert.deepEqual(parseTelegramBotCommand(" /STEER@cpuBot fix this "), {
    name: "steer",
    argument: "fix this",
  });
  assert.equal(parseTelegramBotCommand("normal message"), undefined);
});

test("reload is rejected with a direct reply while Pi is busy", async () => {
  const originalFetch = globalThis.fetch;
  const sentMessages: Array<Record<string, unknown>> = [];
  let getUpdatesCalls = 0;
  let reloadChecks = 0;

  globalThis.fetch = (async (input, init) => {
    const method = String(input).split("/").at(-1)!;
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    if (method === "deleteWebhook") {
      return new Response(JSON.stringify({ ok: true, result: true }));
    }
    if (method === "getUpdates") {
      getUpdatesCalls += 1;
      if (getUpdatesCalls === 1) {
        return new Response(JSON.stringify({ ok: true, result: [] }));
      }
      if (getUpdatesCalls === 2) {
        return new Response(
          JSON.stringify({
            ok: true,
            result: [
              {
                update_id: 1,
                message: {
                  message_id: 2,
                  text: "/reload",
                  chat: { id: 42, type: "private" },
                  from: { id: 42, is_bot: false },
                },
              },
            ],
          }),
        );
      }
      return await new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        signal?.addEventListener(
          "abort",
          () => reject(signal.reason ?? new DOMException("Aborted", "AbortError")),
          { once: true },
        );
      });
    }
    if (method === "sendMessage") {
      sentMessages.push(body);
      return new Response(
        JSON.stringify({ ok: true, result: { message_id: 3 } }),
      );
    }
    throw new Error(`Unexpected Telegram method: ${method}`);
  }) as typeof fetch;

  const connection = new TelegramSessionConnection("test-token", 42);
  try {
    await connection.start(
      () => undefined,
      () => undefined,
      () => "status",
      () => {
        reloadChecks += 1;
        return false;
      },
    );
    for (let attempt = 0; attempt < 50 && sentMessages.length === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(reloadChecks, 1);
    assert.equal(
      sentMessages[0]?.text,
      "Reload is unavailable while Pi is busy. Try /reload again after the current task finishes.",
    );
  } finally {
    await connection.stop();
    globalThis.fetch = originalFetch;
  }
});

test("public commentary replaces thinking with one evolving plain draft", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ method: string; body: Record<string, unknown> }> = [];
  globalThis.fetch = (async (input, init) => {
    const method = String(input).split("/").at(-1)!;
    requests.push({
      method,
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });
    const result = method.endsWith("Draft") ? true : { message_id: 1 };
    return new Response(JSON.stringify({ ok: true, result }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const connection = new TelegramSessionConnection("test-token", 42);
    await connection.beginRichDraft();
    await connection.setDraftActivity("read");
    await new Promise((resolve) => setTimeout(resolve, 1_600));
    await connection.streamCommentaryDraft("First public\ncomment");
    await new Promise((resolve) => setTimeout(resolve, 1_600));
    await connection.updateRichDraft("Latest public comment");
    await connection.setDraftActivity("bash");
    await connection.streamRichDraft("Streaming public text");
    await new Promise((resolve) => setTimeout(resolve, 1_600));
    await connection.sendRichMessage("# Result\n\n| A | B |\n|---|---|\n| 1 | 2 |");

    assert.equal(requests[0]?.method, "sendRichMessageDraft");
    assert.equal(requests[0]?.body.can_stop, false);
    const draftRequests = requests.filter((request) =>
      request.method.endsWith("Draft"),
    );
    const initialDraftId = draftRequests[0]?.body.draft_id;
    assert.ok(
      draftRequests.every((request) => request.body.draft_id === initialDraftId),
    );

    const initialPayload = JSON.stringify(draftRequests[0]?.body.rich_message);
    assert.match(initialPayload, /"type":"thinking"/);
    assert.match(initialPayload, /"type":"custom_emoji"/);
    const richDraftPayloads = draftRequests
      .filter((request) => request.method === "sendRichMessageDraft")
      .map((request) => JSON.stringify(request.body.rich_message));
    assert.ok(richDraftPayloads.some((payload) => payload.includes("Reading files")));
    assert.ok(
      richDraftPayloads.every((payload) => !payload.includes("Running a command")),
    );
    assert.ok(
      requests.every(
        (request) =>
          request.method !== "sendMessage" &&
          request.method !== "editMessageText" &&
          request.method !== "deleteMessage",
      ),
    );

    const plainDrafts = draftRequests.filter(
      (request) => request.method === "sendMessageDraft",
    );
    assert.ok(
      plainDrafts.some((request) =>
        String(request.body.text).startsWith("First public comment"),
      ),
    );
    assert.ok(
      plainDrafts.some((request) =>
        String(request.body.text).startsWith("Latest public comment"),
      ),
    );
    assert.ok(
      plainDrafts.some((request) =>
        String(request.body.text).startsWith("Streaming public text"),
      ),
    );
    assert.deepEqual(requests.at(-1), {
      method: "sendRichMessage",
      body: {
        chat_id: 42,
        rich_message: {
          markdown: "# Result\n\n| A | B |\n|---|---|\n| 1 | 2 |",
        },
      },
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("command menu is scoped to the Telegram owner chat", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ method: string; body: Record<string, unknown> }> = [];
  globalThis.fetch = (async (input, init) => {
    requests.push({
      method: String(input).split("/").at(-1)!,
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });
    return new Response(JSON.stringify({ ok: true, result: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const connection = new TelegramSessionConnection("test-token", 42);
    await connection.configureCommandMenu();

    assert.deepEqual(requests.map((request) => request.method), [
      "setMyCommands",
      "setChatMenuButton",
    ]);
    assert.deepEqual(requests[0]?.body.scope, { type: "chat", chat_id: 42 });
    assert.deepEqual(
      (requests[0]?.body.commands as Array<{ command: string }>).map(
        (command) => command.command,
      ),
      ["help", "status", "steer", "stop", "reload"],
    );
    assert.deepEqual(requests[1]?.body, {
      chat_id: 42,
      menu_button: { type: "commands" },
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("sendDocument uploads a native Telegram document with an optional caption", async () => {
  const originalFetch = globalThis.fetch;
  const directory = await mkdtemp(join(tmpdir(), "pi-telegram-document-"));
  const path = join(directory, "report.txt");
  await writeFile(path, "report contents", "utf8");
  let requestBody: FormData | undefined;
  globalThis.fetch = (async (_input, init) => {
    assert.equal(init?.method, "POST");
    assert.ok(init?.body instanceof FormData);
    requestBody = init.body;
    return new Response(
      JSON.stringify({
        ok: true,
        result: { message_id: 1, chat: { id: 42, type: "private" } },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;

  try {
    const connection = new TelegramSessionConnection("test-token", 42);
    await connection.sendDocument(
      {
        path,
        fileName: "report.txt",
        contentType: "text/plain",
        size: 15,
      },
      "Report ready",
    );

    assert.equal(requestBody?.get("chat_id"), "42");
    assert.equal(requestBody?.get("caption"), "Report ready");
    const document = requestBody?.get("document");
    assert.ok(document instanceof File);
    assert.equal(document.name, "report.txt");
    assert.equal(document.type, "text/plain");
    assert.equal(await document.text(), "report contents");
  } finally {
    globalThis.fetch = originalFetch;
    await rm(directory, { recursive: true, force: true });
  }
});

test("oversized Rich Markdown is rejected rather than reformatted", async () => {
  const connection = new TelegramSessionConnection("test-token", 42);
  await assert.rejects(
    connection.sendRichMessage("x".repeat(32_769)),
    /must not exceed 32768 characters/,
  );
});
