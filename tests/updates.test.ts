import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { installPrefix, installUpdate, latestVersion, newerVersion, runningPackage, applyUpdateWhenIdle } from "../src/updates.ts";
import { TelegramSessionConnection } from "../src/telegram.ts";

test("update versions are strict, ordered numerically and never permit shell input", () => {
  assert.ok(newerVersion("0.10.0", "0.9.9"));
  for (const version of ["0.2.2", "0.1.0", "0.3.0-beta", "1.0.0;echo hi", "01.2.3"])
    assert.equal(newerVersion(version, "0.2.2"), false);
  assert.ok(runningPackage().version);
});

test("registry checks fail quietly and respect offline mode", async () => {
  const oldFetch = globalThis.fetch, offline = process.env.PI_OFFLINE;
  try {
    delete process.env.PI_OFFLINE;
    let calls = 0;
    globalThis.fetch = (async (url, options) => {
      calls++;
      assert.equal(String(url), "https://registry.npmjs.org/@comput%2fpi-telegram/latest");
      assert.ok(options?.signal);
      return new Response(JSON.stringify({ name: "@comput/pi-telegram", version: "0.3.0" }));
    }) as typeof fetch;
    assert.equal(await latestVersion(new AbortController().signal), "0.3.0");
    process.env.PI_OFFLINE = "1";
    assert.equal(await latestVersion(new AbortController().signal), undefined);
    assert.equal(calls, 1);
    delete process.env.PI_OFFLINE;
    globalThis.fetch = (async () => { throw new Error("offline"); }) as typeof fetch;
    assert.equal(await latestVersion(new AbortController().signal), undefined);
    globalThis.fetch = (async () => new Response(JSON.stringify({ name: "other", version: "9.0.0" }))) as typeof fetch;
    assert.equal(await latestVersion(new AbortController().signal), undefined);
  } finally {
    globalThis.fetch = oldFetch;
    if (offline === undefined) delete process.env.PI_OFFLINE; else process.env.PI_OFFLINE = offline;
  }
});

test("installer protects checkouts, pins the offer, verifies results and prevents downgrades", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-update-"));
  const oldAgent = process.env.PI_CODING_AGENT_DIR;
  const controller = new AbortController();
  try {
    process.env.PI_CODING_AGENT_DIR = join(directory, "agent");
    const prefix = join(process.env.PI_CODING_AGENT_DIR, "npm");
    const packagePath = join(prefix, "node_modules", "@comput", "pi-telegram");
    await mkdir(packagePath, { recursive: true });
    const root = await realpath(packagePath);
    const saveVersion = (version: string) => writeFile(join(root, "package.json"), JSON.stringify({ name: "@comput/pi-telegram", version }));
    await saveVersion("0.2.2");
    assert.equal(await installPrefix(root, directory), await realpath(prefix));
    assert.equal(await installPrefix(runningPackage().root, directory), undefined);
    const settingsPath = join(process.env.PI_CODING_AGENT_DIR, "settings.json");
    await writeFile(settingsPath, JSON.stringify({ packages: ["npm:@comput/pi-telegram@0.2.2"] }));
    assert.equal(await installPrefix(root, directory), undefined);
    await writeFile(settingsPath, JSON.stringify({ npmCommand: ["custom-npm"] }));
    assert.equal(await installPrefix(root, directory), undefined);
    await rm(settingsPath);
    let calls = 0;
    const exec = async (command: string, args: string[], options: { signal: AbortSignal }) => {
      calls++;
      assert.equal(command, process.execPath);
      assert.ok(args[0]?.endsWith("npm-cli.js"));
      assert.ok(args.includes("@comput/pi-telegram@0.2.3"));
      assert.ok(args.includes("--legacy-peer-deps"));
      assert.equal(options.signal, controller.signal);
      await saveVersion("0.2.3");
      return { code: 0 };
    };
    const running = { root, version: "0.2.2" };
    await installUpdate(running, "0.2.3", directory, controller.signal, exec);
    await installUpdate(running, "0.2.3", directory, controller.signal, exec);
    assert.equal(calls, 1);
    await saveVersion("0.3.0");
    await assert.rejects(installUpdate(running, "0.2.3", directory, controller.signal, exec), /Installed version changed/);
    await assert.rejects(installUpdate(runningPackage(), "999.0.0", directory, controller.signal, exec), /updated locally/);
    await saveVersion("0.2.2");
    await assert.rejects(installUpdate(running, "0.2.3", directory, controller.signal, async () => ({ code: 1 })), /Installation failed/);
    await assert.rejects(installUpdate(running, "0.2.3", directory, controller.signal, async () => ({ code: 0 })), /could not be verified/);
    controller.abort();
    await assert.rejects(installUpdate(running, "0.2.3", directory, controller.signal, exec));
  } finally {
    if (oldAgent === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = oldAgent;
    await rm(directory, { recursive: true, force: true });
  }
});

test("approved updates wait for idle and never reload a disconnected or failed session", async () => {
  for (const scenario of ["success", "disconnect-before", "disconnect-after", "failure"]) {
    const controller = new AbortController();
    let idle!: () => void;
    const ready = new Promise<void>(resolve => { idle = resolve; });
    const calls: string[] = [];
    const task = applyUpdateWhenIdle(controller.signal, {
      waitForIdle: () => ready,
      isCurrent: () => true,
      install: async () => {
        calls.push("install");
        if (scenario === "failure") throw new Error("failed");
        if (scenario === "disconnect-after") controller.abort();
      },
      reload: async () => { calls.push("reload"); },
    });
    await Promise.resolve();
    assert.deepEqual(calls, []);
    if (scenario === "disconnect-before") controller.abort();
    idle();
    if (scenario === "failure") await assert.rejects(task, /failed/); else await task;
    assert.deepEqual(calls, scenario === "success" ? ["install", "reload"] : scenario === "disconnect-before" ? [] : ["install"]);
  }
});

test("native update buttons require owner, chat, message and nonce; clicks are one-use", async () => {
  const original = globalThis.fetch;
  let sent: any;
  const actions: boolean[] = [];
  const updates: any[] = [];
  const connection = new TelegramSessionConnection("test-token", 42);
  globalThis.fetch = (async (url, init) => {
    const method = String(url).split("/").at(-1);
    const body = JSON.parse(String(init?.body));
    let result: any = true;
    if (method === "sendMessage") { sent = body; result = { message_id: 100 }; }
    if (method === "getWebhookInfo") result = { url: "" };
    if (method === "getUpdates") {
      assert.ok(body.allowed_updates.includes("callback_query"));
      if (body.offset === -1) result = [];
      else if (updates.length) result = updates.splice(0);
      else return new Promise<Response>((_resolve, reject) => {
        if (init?.signal?.aborted) reject(new Error("aborted"));
        else init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
    }
    return new Response(JSON.stringify({ ok: true, result }));
  }) as typeof fetch;
  try {
    await connection.offerUpdate("Update?", "0.2.3", (approved) => { actions.push(approved); });
    const buttons = sent.reply_markup.inline_keyboard[0];
    assert.equal(buttons.length, 2);
    assert.equal(buttons[1].text, "Not now");
    const base = { id: "q", from: { id: 42, is_bot: false }, message: { message_id: 100, chat: { id: 42, type: "private" } }, data: buttons[0].callback_data };
    const queries = [
      { ...base, from: { id: 99, is_bot: false } },
      { ...base, from: { id: 42, is_bot: true } },
      { ...base, message: { ...base.message, chat: { id: 42, type: "group" } } },
      { ...base, message: { ...base.message, message_id: 101 } },
      { ...base, data: "update:forged:yes" },
      base, base,
    ];
    updates.push(...queries.map((callback_query, index) => ({ update_id: index + 1, callback_query })));
    await connection.start(() => { throw new Error("Callbacks must not enter the model"); }, () => {}, () => "status", () => false);
    for (let i = 0; i < 100 && actions.length === 0; i++) await new Promise(r => setTimeout(r, 5));
    assert.deepEqual(actions, [true]);
    await connection.stop();
    // Old buttons cannot authorize anything on a new connection.
    const replacement = new TelegramSessionConnection("test-token", 42);
    await (replacement as any).handleUpdateButton(base);
    assert.deepEqual(actions, [true]);
    await replacement.offerUpdate("Update?", "0.2.3", (approved) => { actions.push(approved); });
    await (replacement as any).handleUpdateButton({ ...base, data: sent.reply_markup.inline_keyboard[0][1].callback_data });
    assert.deepEqual(actions, [true, false]);
    await replacement.stop();
  } finally { await connection.stop(); globalThis.fetch = original; }
});
