import assert from "node:assert/strict";
import test from "node:test";

import {
  createManagedBotUrl,
  findManagedBot,
  pairManualBot,
  validateBotToken,
} from "../src/bot-api.ts";

function ok(result: unknown): Response {
  return new Response(JSON.stringify({ ok: true, result }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

test("validateBotToken gets the canonical identity and manager capability", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    ok({
      id: 123456,
      is_bot: true,
      username: "CanonicalManagerBot",
      can_manage_bots: true,
    })) as typeof fetch;
  try {
    assert.deepEqual(
      await validateBotToken(
        "manager-token",
        "@CanonicalManagerBot",
        true,
      ),
      {
        id: "123456",
        username: "CanonicalManagerBot",
        canManageBots: true,
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("validateBotToken rejects a username mismatch and non-manager", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    ok({ id: 123, is_bot: true, username: "ActualProjectBot" })) as typeof fetch;
  try {
    await assert.rejects(
      () => validateBotToken("token", "ExpectedProjectBot"),
      /belongs to @ActualProjectBot/,
    );
    await assert.rejects(
      () => validateBotToken("token", "ActualProjectBot", true),
      /is not enabled to manage bots/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("managed-bot links use only the explicitly supplied username", () => {
  assert.equal(
    createManagedBotUrl(
      "ExampleManagerBot",
      "UserChosenBot",
      "My project assistant",
    ),
    "https://t.me/newbot/ExampleManagerBot/UserChosenBot?name=My%20project%20assistant",
  );
});

test("findManagedBot obtains, verifies, and restricts a matching child bot", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ method: string; body: Record<string, unknown> }> = [];
  globalThis.fetch = (async (input, init) => {
    const method = /\/([^/]+)$/.exec(String(input))?.[1] || "";
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    calls.push({ method, body });
    if (method === "deleteWebhook") return ok(true);
    if (method === "getUpdates") {
      return ok([
        {
          update_id: 77,
          managed_bot: {
            user: { id: 555, is_bot: false },
            bot: { id: 999, is_bot: true, username: "UserChosenBot" },
          },
        },
      ]);
    }
    if (method === "getManagedBotToken") return ok("child-token");
    if (method === "getMe") {
      return ok({ id: 999, is_bot: true, username: "UserChosenBot" });
    }
    if (method === "setManagedBotAccessSettings") return ok(true);
    throw new Error(`Unexpected method ${method}`);
  }) as typeof fetch;

  try {
    const result = await findManagedBot(
      {
        id: "1",
        username: "ExampleManagerBot",
        token: "manager-token",
        updateOffset: 70,
      },
      "UserChosenBot",
      AbortSignal.timeout(10_000),
    );
    assert.equal(result.nextOffset, 78);
    assert.deepEqual(result.settings, {
      version: 1,
      id: "999",
      username: "UserChosenBot",
      token: "child-token",
      ownerUserId: "555",
      managed: true,
    });
    assert.deepEqual(
      calls.find((call) => call.method === "setManagedBotAccessSettings")?.body,
      { user_id: 999, is_access_restricted: true, added_user_ids: [] },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("manual pairing accepts only the exact private pairing code", async () => {
  const originalFetch = globalThis.fetch;
  let code = "";
  let updatesCalls = 0;
  globalThis.fetch = (async (input) => {
    const method = /\/([^/]+)$/.exec(String(input))?.[1] || "";
    if (method === "getMe") {
      return ok({ id: 321, is_bot: true, username: "ManualProjectBot" });
    }
    if (method === "deleteWebhook") return ok(true);
    if (method === "getUpdates") {
      updatesCalls += 1;
      if (updatesCalls === 1) return ok([]);
      return ok([
        {
          update_id: 10,
          message: {
            text: code,
            chat: { id: 654, type: "private" },
            from: { id: 654, is_bot: false },
          },
        },
      ]);
    }
    throw new Error(`Unexpected method ${method}`);
  }) as typeof fetch;

  try {
    const settings = await pairManualBot(
      "manual-token",
      "ManualProjectBot",
      (value) => {
        code = value;
      },
      AbortSignal.timeout(10_000),
    );
    assert.match(code, /^pair-\d{6}$/);
    assert.deepEqual(settings, {
      version: 1,
      id: "321",
      username: "ManualProjectBot",
      token: "manual-token",
      ownerUserId: "654",
      managed: false,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
