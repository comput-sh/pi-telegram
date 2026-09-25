import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  rm,
  utimes,
  writeFile,
  rename,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  resolveTelegramProjectFile,
  readTelegramProjectFile,
} from "../src/files.ts";
import { acquireTelegramRuntimeLease } from "../src/runtime-lease.ts";
import {
  withManagerLock,
  saveGlobalSettings,
  loadGlobalSettings,
} from "../src/config.ts";
import { TelegramSessionConnection } from "../src/telegram.ts";
import { callTelegramBotApi } from "../src/bot-api.ts";

async function directory(work: (path: string) => Promise<void>) {
  const path = await mkdtemp(join(tmpdir(), "pi-telegram-hardening-"));
  try {
    await work(path);
  } finally {
    await rm(path, { recursive: true, force: true });
  }
}

test("configured global credentials and temp siblings cannot be attachments", async () =>
  directory(async (cwd) => {
    const previous = process.env.PI_TELEGRAM_SETTINGS;
    process.env.PI_TELEGRAM_SETTINGS = join(cwd, "custom-private.json");
    try {
      for (const name of [
        "custom-private.json",
        "custom-private.json.123.456.tmp",
        "pi-telegram.local.json.123.456.tmp",
        ".npmrc",
        "auth.json",
      ]) {
        await writeFile(join(cwd, name), "test-only");
        await assert.rejects(
          resolveTelegramProjectFile(cwd, name),
          /credential|repository/,
        );
      }
    } finally {
      if (previous === undefined) delete process.env.PI_TELEGRAM_SETTINGS;
      else process.env.PI_TELEGRAM_SETTINGS = previous;
    }
  }));

test("upload revalidation rejects a file replaced after resolution", async () =>
  directory(async (cwd) => {
    const path = join(cwd, "report.txt");
    await writeFile(path, "original");
    const file = await resolveTelegramProjectFile(cwd, path);
    await rename(path, join(cwd, "original.txt"));
    await writeFile(path, "replacement");
    await assert.rejects(readTelegramProjectFile(file), /changed/);
  }));

test("concurrent runtime acquisition has exactly one winner", async () =>
  directory(async (cwd) => {
    const env = { PI_TELEGRAM_SETTINGS: join(cwd, "settings.json") };
    const leases = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        acquireTelegramRuntimeLease("111", `session-${index}`, cwd, { env }),
      ),
    );
    assert.equal(leases.filter(Boolean).length, 1);
    for (const lease of leases) await lease?.release();
  }));

test("abandoned heartbeat locks recover through the locking library", async () =>
  directory(async (cwd) => {
    const env = { PI_TELEGRAM_SETTINGS: join(cwd, "settings.json") };
    const guard = join(cwd, "runtime", "111.lock.guard");
    await mkdir(guard, { recursive: true });
    const old = new Date(Date.now() - 180_000);
    await utimes(guard, old, old);
    const lease = await acquireTelegramRuntimeLease("111", "resumed", cwd, {
      env,
    });
    assert.ok(lease);
    await lease.release();
  }));

test("manager read-modify-write is serialized and nested saves keep the lock", async () =>
  directory(async (cwd) => {
    const env = { PI_TELEGRAM_SETTINGS: join(cwd, "settings.json") };
    await withManagerLock(async () => {
      await saveGlobalSettings({ version: 1, provisioningMode: "manual" }, env);
      await assert.rejects(
        withManagerLock(async () => {}, env),
        /Another Pi session/,
      );
      assert.equal((await loadGlobalSettings(env))?.provisioningMode, "manual");
    }, env);
  }));

test("passive connection never removes an existing webhook", async () => {
  const previous = globalThis.fetch;
  const methods: string[] = [];
  globalThis.fetch = (async (input) => {
    methods.push(String(input).split("/").at(-1)!);
    return new Response(
      JSON.stringify({
        ok: true,
        result: { url: "https://example.test/webhook" },
      }),
    );
  }) as typeof fetch;
  const connection = new TelegramSessionConnection("test-token", 42);
  try {
    await assert.rejects(
      connection.start(
        () => {},
        () => {},
        () => "",
        () => false,
      ),
      /webhook/,
    );
    assert.deepEqual(methods, ["getWebhookInfo"]);
  } finally {
    await connection.stop();
    globalThis.fetch = previous;
  }
});

test("raw fetch errors cannot expose token-bearing URLs", async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = (async (input) => {
    throw new Error(`Failed ${input}`);
  }) as typeof fetch;
  try {
    await assert.rejects(
      callTelegramBotApi("test-token", "getMe"),
      (error: Error) =>
        !error.message.includes("test-token") && error.cause === undefined,
    );
    await assert.rejects(
      new TelegramSessionConnection("test-token", 42).sendPlainMessage("hello"),
      (error: Error) =>
        !error.message.includes("test-token") && error.cause === undefined,
    );
  } finally {
    globalThis.fetch = previous;
  }
});

test("background control failures surface a rate-limited warning", async () => {
  const previous = globalThis.fetch;
  let fail = false;
  let warnings = 0;
  globalThis.fetch = (async () => {
    if (fail) throw new Error("offline");
    return new Response(JSON.stringify({ ok: true, result: true }));
  }) as typeof fetch;
  const connection = new TelegramSessionConnection("test-token", 42, {
    onDraftError: () => {
      warnings++;
    },
  });
  try {
    fail = true;
    connection.sendControlNotice("control notice");
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(warnings, 1);
    connection.sendControlNotice("later control notice");
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(warnings, 1);
  } finally {
    await connection.stop();
    globalThis.fetch = previous;
  }
});

test("stop is controlled by the active request even without a draft", async () => {
  const previous = globalThis.fetch;
  let stopped = 0;
  let updates = 0;
  globalThis.fetch = (async (input, init) => {
    const method = String(input).split("/").at(-1);
    const ok = (result: unknown) =>
      new Response(JSON.stringify({ ok: true, result }));
    if (method === "getWebhookInfo") return ok({ url: "" });
    if (method !== "getUpdates") return ok(true);
    updates++;
    if (updates === 1) return ok([]);
    if (updates === 2)
      return ok([
        {
          update_id: 1,
          message: {
            message_id: 1,
            text: "stop",
            chat: { id: 42, type: "private" },
            from: { id: 42, is_bot: false },
          },
        },
      ]);
    return new Promise<Response>((_resolve, reject) =>
      init?.signal?.addEventListener(
        "abort",
        () => reject(new Error("abort")),
        { once: true },
      ),
    );
  }) as typeof fetch;
  const connection = new TelegramSessionConnection("test-token", 42, {
    canStop: () => true,
  });
  try {
    await connection.start(
      () => {},
      () => {
        stopped++;
      },
      () => "",
      () => false,
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(stopped, 1);
  } finally {
    await connection.stop();
    globalThis.fetch = previous;
  }
});
