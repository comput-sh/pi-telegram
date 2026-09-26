import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ConnectionManager } from "../src/connection-manager.ts";
import { saveProjectSettings } from "../src/config.ts";

async function fixture(work: (f: any) => Promise<void>, feedbackEndpoint?: string) {
  const cwd = await mkdtemp(join(tmpdir(), "pi-notice-"));
  const previousFetch = globalThis.fetch, previousSettings = process.env.PI_TELEGRAM_SETTINGS;
  process.env.PI_TELEGRAM_SETTINGS = join(cwd, "global", "settings.json");
  const bot = { id: "998877", username: "NoticeTestBot", token: "test-placeholder", ownerUserId: "42", managed: false, sessionId: "main" };
  const calls: string[] = [], warnings: string[] = [];
  const ctx = { cwd, sessionManager: { getSessionId: () => "main" }, ui: { setStatus() {}, notify: (text: string) => warnings.push(text), theme: { fg: (_: string, text: string) => text } } } as any;
  let connected = 0;
  const manager = new ConnectionManager({ input() {}, canStop: () => false, stopTask() {}, disconnected() {}, reload: () => false, connected: () => { connected++; }, version: "test", feedbackEndpoint });
  let handler: (method: string, signal: AbortSignal) => Promise<Response | undefined> = async () => undefined;
  const ok = (result: unknown) => new Response(JSON.stringify({ ok: true, result }));
  globalThis.fetch = (async (url, init) => {
    const method = String(url).split("/").at(-1)!;
    const body = JSON.parse(String(init?.body));
    calls.push(method);
    const result = await handler(method, init!.signal!);
    if (result) return result;
    if (method === "getWebhookInfo") return ok({ url: "" });
    if (method === "getUpdates") {
      if (body.offset === -1) return ok([]);
      return new Promise<Response>((_resolve, reject) => {
        if (init!.signal!.aborted) reject(new Error("aborted"));
        else init!.signal!.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
    }
    return ok(true);
  }) as typeof fetch;
  try {
    await saveProjectSettings(cwd, { version: 2, bots: [bot] });
    await work({ manager, bot, ctx, calls, warnings, connected: () => connected, handle: (fn: typeof handler) => { handler = fn; }, ok });
  } finally {
    await manager.disconnect(ctx);
    globalThis.fetch = previousFetch;
    if (previousSettings === undefined) delete process.env.PI_TELEGRAM_SETTINGS; else process.env.PI_TELEGRAM_SETTINGS = previousSettings;
    await rm(cwd, { recursive: true, force: true });
  }
}

test("feedback wiring retains trusted bot identity while disabled and uses the loaded version when configured", async () => {
  for (const endpoint of [undefined, "https://feedback.example.invalid/submit"]) {
    await fixture(async ({ manager, bot, ctx }: any) => {
      assert.equal(await manager.connect(bot, ctx, new AbortController().signal), true);
      const options = manager.connection.options;
      assert.equal(options.botId, Number(bot.id));
      assert.deepEqual(options.feedback, endpoint === undefined ? undefined : { endpoint, version: "test" });
    }, endpoint);
  }
});

test("slow menu APIs cannot block Connected or startup completion; disconnect aborts menu work", async () => {
  for (const slowMethod of ["setMyCommands", "setChatMenuButton"]) {
    await fixture(async ({ manager, bot, ctx, calls, warnings, handle, connected }: any) => {
      let entered!: () => void;
      const menuStarted = new Promise<void>(resolve => { entered = resolve; });
      let aborted = false;
      handle(async (method: string, signal: AbortSignal) => {
        if (method !== slowMethod) return undefined;
        entered();
        return new Promise<Response>((_resolve, reject) => {
          signal.addEventListener("abort", () => { aborted = true; reject(new Error("aborted")); }, { once: true });
        });
      });
      // The short deadline reproduces startup budget exhaustion without a 30s test.
      assert.equal(await manager.connect(bot, ctx, AbortSignal.timeout(1000)), true);
      await menuStarted;
      assert.ok(calls.indexOf("sendMessage") < calls.indexOf("setMyCommands"));
      assert.equal(connected(), 1);
      assert.ok(manager.connection);
      await manager.disconnect(ctx);
      await new Promise(resolve => setTimeout(resolve, 10));
      assert.equal(aborted, true);
      assert.deepEqual(warnings, [], "shutdown cancellation must not report a menu error on the replacement session");
    });
  }
});

test("menu failures warn locally without undoing a successful connection", async () =>
  fixture(async ({ manager, bot, ctx, handle, warnings, connected }: any) => {
    handle(async (method: string) => { if (method === "setMyCommands") throw new Error("offline"); });
    assert.equal(await manager.connect(bot, ctx, new AbortController().signal), true);
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(connected(), 1);
    assert.ok(manager.connection);
    assert.ok(warnings.some((text: string) => text.includes("command menu")));
  }));

test("an initializing connection is not ready and a failed notice releases it for retry", async () =>
  fixture(async ({ manager, bot, ctx, handle, calls, connected }: any) => {
    let entered!: () => void, fail!: () => void;
    const sending = new Promise<void>(resolve => { entered = resolve; });
    const release = new Promise<void>(resolve => { fail = resolve; });
    handle(async (method: string) => { if (method === "sendMessage") { entered(); await release; throw new Error("offline"); } });
    const attempt = manager.connect(bot, ctx, new AbortController().signal);
    const rejected = assert.rejects(attempt, /connection notice/);
    await sending;
    assert.equal(await manager.connect(bot, ctx, new AbortController().signal), false);
    fail();
    await rejected;
    assert.equal(manager.connection, undefined);
    assert.equal(connected(), 0);
    assert.ok(!calls.includes("setMyCommands"));
    handle(async () => undefined);
    assert.equal(await manager.connect(bot, ctx, new AbortController().signal), true);
  }));
