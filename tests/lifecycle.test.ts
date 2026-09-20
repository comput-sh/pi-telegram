import assert from "node:assert/strict";
import { mkdtemp, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import extension from "../src/index.ts";
import {
  assignProjectBot,
  loadProjectSettings,
  loadGlobalSettings,
  saveProjectSettings,
  saveGlobalSettings,
  type ProjectBotSettings,
} from "../src/config.ts";
import { acquireTelegramRuntimeLease } from "../src/runtime-lease.ts";
import { stageAssignment } from "../src/assignment.ts";
import { wrapTelegramInput } from "../src/routing.ts";

// Exercise the registered extension events/commands, not just helper functions.
type Handler = (event: any, ctx: any) => any;
const bot = (
  id = "111",
  sessionId: string | null = "main",
): ProjectBotSettings => ({
  id,
  username: `Example${id}Bot`,
  token: `test-${id}`,
  ownerUserId: "42",
  managed: false,
  sessionId,
});
function harness(cwd: string, sessionId = "main") {
  const events = new Map<string, Handler[]>();
  const commands = new Map<string, Handler>();
  const tools = new Map<string, any>();
  const sent: string[] = [];
  const deliveries: Array<{ deliverAs: string }> = [];
  const notices: string[] = [];
  let prompts = 0;
  let idle = true;
  let aborts = 0;
  const choices: Array<string | undefined> = [];
  const inputs: Array<string | undefined> = [];
  const ctx = {
    cwd,
    mode: "tui",
    hasUI: true,
    sessionManager: { getSessionId: () => sessionId, getBranch: () => [] },
    isIdle: () => idle,
    abort: () => {
      aborts++;
    },
    ui: {
      notify: (message: string) => notices.push(message),
      setStatus: () => {},
      theme: { fg: (_color: string, text: string) => text },
      select: async (_title: string, options: string[]) => {
        prompts++;
        const choice = choices.shift();
        return choice === "FIRST" ? options[0] : choice;
      },
      input: async () => {
        prompts++;
        return inputs.shift();
      },
      custom: async () => {
        prompts++;
        return "test-111";
      },
      confirm: async () => {
        prompts++;
        return true;
      },
    },
  } as unknown as ExtensionContext;
  const api = {
    on: (name: string, handler: Handler) =>
      events.set(name, [...(events.get(name) ?? []), handler]),
    registerCommand: (name: string, options: { handler: Handler }) =>
      commands.set(name, options.handler),
    registerTool: (tool: any) => tools.set(tool.name, tool),
    sendUserMessage: (content: string, options: { deliverAs: string }) => {
      sent.push(content);
      deliveries.push(options);
    },
  } as unknown as ExtensionAPI;
  extension(api);
  const emit = async (name: string, event: unknown = {}) => {
    for (const handler of events.get(name) ?? []) await handler(event, ctx);
  };
  return {
    ctx,
    sent,
    deliveries,
    notices,
    choices,
    inputs,
    emit,
    command: (name: string) => commands.get(name)!("", ctx),
    tool: (name: string, params: unknown = {}) => tools.get(name).execute("test", params, undefined, undefined, ctx),
    prompts: () => prompts,
    setIdle: (value: boolean) => {
      idle = value;
    },
    aborts: () => aborts,
  };
}

async function fixture(
  work: (
    cwd: string,
    network: {
      calls: string[];
      messages: string[];
      failToken?: string;
      failMessages?: boolean;
      inbound: unknown[];
      managedUpdates?: unknown[];
    },
  ) => Promise<void>,
) {
  const cwd = await mkdtemp(join(tmpdir(), "pi-telegram-lifecycle-"));
  const previousEnv = process.env.PI_TELEGRAM_SETTINGS;
  const previousFetch = globalThis.fetch;
  process.env.PI_TELEGRAM_SETTINGS = join(cwd, "global", "settings.json");
  const network: {
    calls: string[];
    messages: string[];
    failToken?: string;
    failMessages?: boolean;
    inbound: unknown[];
    managedUpdates?: unknown[];
  } = { calls: [], messages: [], inbound: [] };
  globalThis.fetch = (async (url, init) => {
    if (String(url).startsWith("https://registry.npmjs.org/"))
      return new Response(JSON.stringify({ name: "@comput/pi-telegram", version: "0.0.0" }));
    if (String(url).startsWith("https://api.telegram.org/file/")) {
      network.calls.push("downloadFile");
      return new Response("hello");
    }
    const method = String(url).split("/").at(-1)!;
    network.calls.push(method);
    const body = JSON.parse(String(init?.body ?? "{}"));
    if (method === "sendMessage") network.messages.push(body.text);
    if (network.failToken && String(url).includes(network.failToken))
      throw new Error("network unavailable");
    const ok = (result: unknown) =>
      new Response(JSON.stringify({ ok: true, result }));
    if (method === "getFile") return ok({ file_path: "documents/file.txt", file_size: 5 });
    if (method === "getMe")
      return ok({ id: 111, is_bot: true, username: "Example111Bot" });
    if (method === "getWebhookInfo") return ok({ url: "" });
    if (method === "sendMessage" && network.failMessages)
      throw new Error("offline");
    if (method === "getManagedBotToken") return ok("test-111");
    if (method !== "getUpdates") return ok(true);
    if (body.allowed_updates?.includes("managed_bot"))
      return ok(network.managedUpdates ?? []);
    if (body.offset === -1) return ok([]);
    if (network.inbound.length) return ok(network.inbound.splice(0));
    return new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (signal?.aborted) {
        reject(new Error("aborted"));
        return;
      }
      signal?.addEventListener("abort", () => reject(new Error("aborted")), {
        once: true,
      });
    });
  }) as typeof fetch;
  try {
    await work(cwd, network);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousEnv === undefined) delete process.env.PI_TELEGRAM_SETTINGS;
    else process.env.PI_TELEGRAM_SETTINGS = previousEnv;
    await rm(cwd, { recursive: true, force: true });
  }
}

test("successful manual pairing transfers its lease to the connected runtime", async () =>
  fixture(async (cwd, network) => {
    const pi = harness(cwd);
    pi.inputs.push("Example111Bot");
    let prompts = 0;
    pi.ctx.ui.custom = (async (factory: Function) => {
      if (++prompts === 1) return "test-111";
      return new Promise((resolve) => {
        let component: any;
        component = factory(
          {
            requestRender() {
              const code = component
                .render(200)
                .join(" ")
                .match(/pair-\d+/)?.[0];
              if (code)
                network.inbound.push({
                  update_id: 1,
                  message: {
                    text: code,
                    chat: { id: 42, type: "private" },
                    from: { id: 42, is_bot: false },
                  },
                });
            },
          },
          {},
          {},
          resolve,
        );
      });
    }) as typeof pi.ctx.ui.custom;
    try {
      await pi.command("telegram-setup-bot");
      assert.equal(
        (await loadProjectSettings(cwd))?.bots[0]?.sessionId,
        "main",
      );
      assert.equal(
        await acquireTelegramRuntimeLease("111", "other", cwd),
        undefined,
      );
      await pi.command("telegram-release");
      const lease = await acquireTelegramRuntimeLease("111", "other", cwd);
      assert.ok(lease);
      await lease.release();
    } finally {
      await pi.emit("session_shutdown");
    }
  }));

test("completion tool is passive without pending setup and rejects other sessions", async () =>
  fixture(async (cwd, network) => {
    const pi = harness(cwd);
    assert.equal((await pi.tool("telegram_complete_setup")).details.status, "none");
    assert.equal(pi.prompts(), 0);
    assert.equal(network.calls.length, 0);
    await saveGlobalSettings({ version: 1, provisioningMode: "manager", manager: {
      id: "999", username: "ManagerBot", token: "test-manager", pending: {
        username: "Example111Bot", displayName: "Example", requestedAt: new Date().toISOString(),
        projectPath: await realpath(cwd), sessionId: "other",
      },
    } });
    assert.equal((await pi.tool("telegram_complete_setup")).details.status, "other_session");
    assert.equal(network.calls.length, 0);
    assert.equal(pi.prompts(), 0);
    assert.equal((await loadGlobalSettings())?.provisioningMode, "manager");
  }));

test("completion refuses legacy and other-project requests and cancelled setup cannot be resurrected", async () =>
  fixture(async (cwd, network) => {
    const pending = { username: "Example111Bot", displayName: "Example", requestedAt: new Date().toISOString() };
    const manager = { id: "999", username: "ManagerBot", token: "test-manager" };
    await saveGlobalSettings({ version: 1, provisioningMode: "manager", manager: { ...manager, pending } });
    const pi = harness(cwd);
    assert.equal((await pi.tool("telegram_complete_setup")).details.status, "legacy_pending");
    assert.equal(pi.prompts(), 0);
    await saveGlobalSettings({ version: 1, provisioningMode: "manager", manager: {
      ...manager, pending: { ...pending, sessionId: "main", projectPath: join(cwd, "other") },
    } });
    assert.equal((await pi.tool("telegram_complete_setup")).details.status, "other_session");
    assert.equal(network.calls.length, 0);
    await saveGlobalSettings({ version: 1, provisioningMode: "manager", manager: { ...manager, pending } });
    pi.choices.push("Add a bot…", "Complete @Example111Bot");
    pi.ctx.ui.confirm = async () => {
      await saveGlobalSettings({ version: 1, provisioningMode: "manager", manager });
      return true;
    };
    await assert.rejects(pi.command("telegram-start"), /Pending creation changed/);
    const current = await loadGlobalSettings();
    assert.ok(current?.provisioningMode === "manager");
    assert.equal(current.manager.pending, undefined);
    assert.equal(network.calls.length, 0);
  }));

test("done checks pending creation then connects without menu navigation", async () =>
  fixture(async (cwd, network) => {
    await saveGlobalSettings({ version: 1, provisioningMode: "manager", manager: {
      id: "999", username: "ManagerBot", token: "test-manager",
    } });
    const pi = harness(cwd);
    pi.choices.push("Add a bot…", "Create managed bot");
    pi.inputs.push("Example111Bot", "Example");
    try {
      await pi.command("telegram-start");
      const settings = await loadGlobalSettings();
      assert.ok(settings?.provisioningMode === "manager");
      assert.equal(settings.manager.pending?.sessionId, "main");
      assert.equal(settings.manager.pending?.projectPath, await realpath(cwd));
      const prompts = pi.prompts();
      const waiting = await pi.tool("telegram_complete_setup");
      assert.equal(waiting.details.status, "pending");
      assert.match(waiting.details.message, /Still waiting/);
      assert.equal(pi.prompts(), prompts);
      network.managedUpdates = [{ update_id: 7, managed_bot: {
        user: { id: 42, is_bot: false },
        bot: { id: 111, is_bot: true, username: "Example111Bot" },
      } }];
      const completed = await pi.tool("telegram_complete_setup");
      assert.equal(completed.details.status, "connected");
      assert.equal(pi.prompts(), prompts);
      assert.equal((await loadProjectSettings(cwd))?.bots[0]?.sessionId, "main");
      assert.equal((await pi.tool("telegram_complete_setup")).details.status, "none");
    } finally { await pi.emit("session_shutdown"); }
  }));

test("start offers pending completion first while preserving transfer confirmation", async () =>
  fixture(async (cwd, network) => {
    await saveProjectSettings(cwd, { version: 2, bots: [bot("111", "other")] });
    await saveGlobalSettings({ version: 1, provisioningMode: "manager", manager: {
      id: "999", username: "ManagerBot", token: "test-manager", pending: {
        username: "Example111Bot", displayName: "Example", requestedAt: new Date().toISOString(),
        projectPath: await realpath(cwd), sessionId: "main",
      },
    } });
    network.managedUpdates = [{ update_id: 7, managed_bot: {
      user: { id: 42, is_bot: false }, bot: { id: 111, is_bot: true, username: "Example111Bot" },
    } }];
    const pi = harness(cwd);
    pi.choices.push("FIRST");
    let confirmed = false;
    pi.ctx.ui.confirm = async () => { confirmed = true; return false; };
    await pi.command("telegram-start");
    assert.ok(confirmed);
    assert.equal(pi.prompts(), 1);
    assert.equal((await loadProjectSettings(cwd))?.bots[0]?.sessionId, "other");
  }));

test("managed completion does not silently transfer an existing assigned bot", async () =>
  fixture(async (cwd, network) => {
    await saveProjectSettings(cwd, { version: 2, bots: [bot("111", "other")] });
    await saveGlobalSettings({
      version: 1,
      provisioningMode: "manager",
      manager: {
        id: "999",
        username: "ManagerBot",
        token: "test-manager",
        pending: {
          username: "Example111Bot",
          displayName: "Example",
          requestedAt: new Date().toISOString(),
        },
      },
    });
    network.managedUpdates = [
      {
        update_id: 7,
        managed_bot: {
          user: { id: 42, is_bot: false },
          bot: { id: 111, is_bot: true, username: "Example111Bot" },
        },
      },
    ];
    const pi = harness(cwd);
    pi.choices.push("Add a bot…", "Complete @Example111Bot");
    let confirmed = false;
    pi.ctx.ui.confirm = async () => {
      confirmed = true;
      return false;
    };
    await pi.command("telegram-start");
    assert.equal(confirmed, true);
    assert.equal((await loadProjectSettings(cwd))?.bots[0]?.sessionId, "other");
  }));

test("unconfigured and differently assigned session startup is completely passive", async () =>
  fixture(async (cwd, network) => {
    const pi = harness(cwd);
    await pi.emit("session_start");
    assert.equal(pi.prompts(), 0);
    assert.equal(network.calls.length, 0);
    await saveProjectSettings(cwd, { version: 2, bots: [bot("111", "other")] });
    await pi.emit("session_start");
    assert.equal(pi.prompts(), 0);
    assert.equal(network.calls.length, 0);
    await pi.emit("session_shutdown");
  }));

test("new/fork sessions stay passive; resume reconnects; duplicate process cannot poll", async () =>
  fixture(async (cwd, network) => {
    await saveProjectSettings(cwd, { version: 2, bots: [bot()] });
    const main = harness(cwd);
    const duplicate = harness(cwd);
    const fork = harness(cwd, "fork");
    try {
      await main.emit("session_start", { reason: "startup" });
      // Menu configuration now completes in the background for the original
      // connection; it is not evidence that the duplicate started polling.
      const connectionCalls = () => network.calls.filter(method => method !== "setMyCommands" && method !== "setChatMenuButton").length;
      const count = connectionCalls();
      await duplicate.emit("session_start", { reason: "resume" });
      assert.equal(connectionCalls(), count);
      await duplicate.emit("session_shutdown");
      await main.emit("session_shutdown", { reason: "fork" });
      await fork.emit("session_start", { reason: "fork" });
      assert.equal(connectionCalls(), count);
      await fork.emit("session_shutdown", { reason: "resume" });
      await main.emit("session_start", { reason: "resume" });
      assert.ok(connectionCalls() > count);
      assert.equal(main.prompts(), 0);
    } finally {
      await main.emit("session_shutdown");
      await duplicate.emit("session_shutdown");
      await fork.emit("session_shutdown");
    }
  }));

test("confirmed transfer hands off polling and release preserves credentials", async () =>
  fixture(async (cwd) => {
    await saveProjectSettings(cwd, { version: 2, bots: [bot()] });
    const main = harness(cwd);
    const research = harness(cwd, "research");
    try {
      await main.emit("session_start");
      await research.emit("session_start");
      research.choices.push("FIRST");
      await research.command("telegram-start");
      assert.equal(
        (await loadProjectSettings(cwd))?.bots[0]?.sessionId,
        "research",
      );
      assert.ok(main.notices.some((text) => text.includes("ownership")));
      await research.command("telegram-release");
      assert.deepEqual((await loadProjectSettings(cwd))?.bots, [
        bot("111", null),
      ]);
    } finally {
      await main.emit("session_shutdown");
      await research.emit("session_shutdown");
    }
  }));

test("a stale transfer confirmation cannot overwrite an intervening assignment", async () =>
  fixture(async (cwd, network) => {
    await saveProjectSettings(cwd, { version: 2, bots: [bot("111", "other")] });
    const pi = harness(cwd);
    pi.choices.push("FIRST");
    pi.ctx.ui.confirm = async () => {
      await assignProjectBot(cwd, "111", "third");
      return true;
    };
    await assert.rejects(pi.command("telegram-start"), /assignments changed/);
    assert.equal((await loadProjectSettings(cwd))?.bots[0]?.sessionId, "third");
    assert.equal(network.calls.length, 0);
  }));

test("failed switch rolls back and preserves the previous session bot", async () =>
  fixture(async (cwd, network) => {
    const original = { version: 2 as const, bots: [bot(), bot("222", null)] };
    await saveProjectSettings(cwd, original);
    const pi = harness(cwd);
    try {
      await pi.emit("session_start");
      pi.choices.push("@Example222Bot — unassigned");
      network.failToken = "test-222";
      await assert.rejects(pi.command("telegram-start"), /transport/);
      assert.deepEqual(await loadProjectSettings(cwd), original);
      await pi.command("telegram-status");
      assert.ok(pi.notices.at(-1)?.includes("connected here"));
    } finally {
      await pi.emit("session_shutdown");
    }
  }));

test("rollback refuses to undo another session's later transfer", async () =>
  fixture(async (cwd) => {
    const original = { version: 2 as const, bots: [bot()] };
    await saveProjectSettings(cwd, original);
    const transaction = await stageAssignment(cwd, bot(), "research", original);
    await assignProjectBot(cwd, "111", "third");
    await assert.rejects(transaction.rollback(), /assignments changed/);
    assert.equal((await loadProjectSettings(cwd))?.bots[0]?.sessionId, "third");
  }));

test("offline release still disconnects and clears assignment", async () =>
  fixture(async (cwd, network) => {
    await saveProjectSettings(cwd, { version: 2, bots: [bot()] });
    const pi = harness(cwd);
    try {
      await pi.emit("session_start");
      network.failMessages = true;
      await pi.command("telegram-release");
      assert.equal((await loadProjectSettings(cwd))?.bots[0]?.sessionId, null);
      const lease = await acquireTelegramRuntimeLease("111", "new", cwd);
      assert.ok(lease);
      await lease.release();
    } finally {
      await pi.emit("session_shutdown");
    }
  }));

test("manual pairing cannot poll while another runtime holds the bot lease", async () =>
  fixture(async (cwd, network) => {
    const lease = await acquireTelegramRuntimeLease("111", "other", cwd);
    const pi = harness(cwd);
    pi.inputs.push("Example111Bot");
    try {
      await assert.rejects(
        pi.command("telegram-setup-bot"),
        /already polling elsewhere/,
      );
      assert.ok(!network.calls.includes("getUpdates"));
      assert.ok(!network.calls.includes("deleteWebhook"));
      assert.equal(await loadProjectSettings(cwd), undefined);
    } finally {
      await lease?.release();
    }
  }));

test("escape from managed display name cancels without provisioning", async () =>
  fixture(async (cwd, network) => {
    await saveGlobalSettings({
      version: 1,
      provisioningMode: "manager",
      manager: { id: "999", username: "ManagerBot", token: "test-manager" },
    });
    const pi = harness(cwd);
    pi.choices.push("Add a bot…", "Create managed bot");
    pi.inputs.push("ChosenBot", undefined);
    await pi.command("telegram-start");
    assert.equal(network.calls.length, 0);
    assert.equal(await loadProjectSettings(cwd), undefined);
  }));

test("shutdown cancels an outstanding setup before it can assign or connect", async () =>
  fixture(async (cwd, network) => {
    await saveProjectSettings(cwd, { version: 2, bots: [bot("111", "other")] });
    const pi = harness(cwd);
    pi.choices.push("FIRST");
    pi.ctx.ui.confirm = async () => {
      await pi.emit("session_shutdown");
      return true;
    };
    await assert.rejects(pi.command("telegram-start"), /session closed/);
    assert.equal((await loadProjectSettings(cwd))?.bots[0]?.sessionId, "other");
    assert.equal(network.calls.length, 0);
  }));

test("busy owner attachments remain follow-ups without queued notices; captions are not commands", async () =>
  fixture(async (cwd, network) => {
    await saveProjectSettings(cwd, { version: 2, bots: [bot()] });
    const pi = harness(cwd);
    pi.setIdle(false);
    try {
      network.inbound.push({ update_id: 1, message: { message_id: 1,
        caption: "/stop", document: { file_id: "doc", file_name: "report.txt", file_size: 5 },
        chat: { id: 42, type: "private" }, from: { id: 99, is_bot: false },
      } }, { update_id: 2, message: { message_id: 2,
        caption: "/stop", document: { file_id: "doc", file_name: "report.txt", file_size: 5 },
        chat: { id: 42, type: "private" }, from: { id: 42, is_bot: false },
      } });
      await pi.emit("session_start");
      for (let i = 0; i < 100 && !pi.sent.length; i++) await new Promise(r => setTimeout(r, 20));
      assert.equal(pi.sent.length, 1);
      assert.equal(network.calls.filter(method => method === "getFile").length, 1);
      assert.match(pi.sent[0]!, /User caption:\n\/stop/);
      assert.match(pi.sent[0]!, /\.pi\/telegram-inbox\//);
      assert.match(pi.sent[0]!, /untrusted data/);
      assert.ok(network.messages.includes("Downloading attachment…"));
      for (let i = 0; i < 100 && !network.messages.includes("Received attachment (5 bytes)."); i++) await new Promise(r => setTimeout(r, 10));
      assert.ok(network.messages.includes("Received attachment (5 bytes)."));
      assert.equal(pi.deliveries[0]?.deliverAs, "followUp");
      assert.ok(!network.messages.some(text => text.includes("Queued")));
      assert.equal(pi.aborts(), 0);
      const text = pi.sent[0]!;
      await pi.emit("input", { text, source: "extension" });
      await pi.emit("message_start", { message: { role: "user", content: text } });
      assert.ok(!network.calls.includes("sendRichMessageDraft"));
      await pi.tool("telegram_send", { message: "Received your file." });
      assert.ok(network.calls.includes("sendRichMessage"));
    } finally { await pi.emit("session_shutdown"); }
  }));

test("captionless photos reach the agent with an ask-before-inspecting instruction", async () =>
  fixture(async (cwd, network) => {
    await saveProjectSettings(cwd, { version: 2, bots: [bot()] });
    network.inbound.push({ update_id: 1, message: { message_id: 1,
      photo: [{ file_id: "small", width: 10, height: 10, file_size: 5 }, { file_id: "large", width: 100, height: 100, file_size: 5 }],
      chat: { id: 42, type: "private" }, from: { id: 42, is_bot: false },
    } });
    const original = globalThis.fetch;
    let requested = "";
    globalThis.fetch = (async (url, init) => {
      if (String(url).endsWith("/getFile")) requested = JSON.parse(String(init?.body)).file_id;
      return original(url, init);
    }) as typeof fetch;
    const pi = harness(cwd);
    try {
      await pi.emit("session_start");
      for (let i = 0; i < 100 && !pi.sent.length; i++) await new Promise(r => setTimeout(r, 20));
      assert.equal(requested, "large");
      assert.equal(pi.sent.length, 1);
      assert.match(pi.sent[0]!, /Received Telegram photo/);
      assert.match(pi.sent[0]!, /ask what they want done; do not inspect/);
    } finally { await pi.emit("session_shutdown"); }
  }));

test("stop can cancel an in-flight attachment without admitting a request", async () =>
  fixture(async (cwd, network) => {
    await saveProjectSettings(cwd, { version: 2, bots: [bot()] });
    network.inbound.push({ update_id: 1, message: { message_id: 1,
      document: { file_id: "doc", file_name: "log.txt" },
      chat: { id: 42, type: "private" }, from: { id: 42, is_bot: false },
    } }, { update_id: 2, message: { message_id: 2, text: "/stop",
      chat: { id: 42, type: "private" }, from: { id: 42, is_bot: false },
    } });
    const pi = harness(cwd);
    try {
      await pi.emit("session_start");
      for (let i = 0; i < 100 && !network.messages.some(text => text.includes("cancelled")); i++) await new Promise(r => setTimeout(r, 20));
      assert.ok(network.messages.some(text => text.includes("cancellation requested")));
      assert.equal(pi.sent.length, 0);
    } finally { await pi.emit("session_shutdown"); }
  }));

test("startup recovers from a transient failure and reconnects across repeated reloads", async () =>
  fixture(async (cwd, network) => {
    await saveProjectSettings(cwd, { version: 2, bots: [bot()] });
    const pi = harness(cwd);
    try {
      network.failToken = "test-111";
      await pi.emit("session_start");
      network.failToken = undefined;
      for (let i = 0; i < 200 && !network.messages.some(text => text.startsWith("Connected")); i++)
        await new Promise(resolve => setTimeout(resolve, 20));
      assert.ok(network.messages.some(text => text.startsWith("Connected")));
      for (let i = 0; i < 3; i++) {
        await pi.emit("session_shutdown");
        const count = network.messages.filter(text => text.startsWith("Connected")).length;
        await pi.emit("session_start");
        assert.equal(network.messages.filter(text => text.startsWith("Connected")).length, count + 1);
        assert.equal((await loadProjectSettings(cwd))?.bots[0]?.sessionId, "main");
      }
    } finally { await pi.emit("session_shutdown"); }
  }));

test("telegram_send can notify proactively, but requires this session's verified assignment", async () =>
  fixture(async (cwd, network) => {
    const pi = harness(cwd);
    await assert.rejects(pi.tool("telegram_send", { message: "not connected" }), /No ready Telegram/);
    await saveProjectSettings(cwd, { version: 2, bots: [bot()] });
    try {
      await pi.emit("session_start");
      // No Telegram receipt or inbound user message has been created.
      await pi.tool("telegram_send", { message: "Background task finished" });
      assert.equal(network.calls.filter(method => method === "sendRichMessage").length, 1);
      await saveProjectSettings(cwd, { version: 2, bots: [bot("111", "other")] });
      await assert.rejects(pi.tool("telegram_send", { message: "wrong session" }), /assignment changed|No ready/);
      assert.equal(network.calls.filter(method => method === "sendRichMessage").length, 1);
    } finally { await pi.emit("session_shutdown"); }
  }));

test("inbound requests are delivered without automatic replies; telegram_send replies explicitly", async () =>
  fixture(async (cwd, network) => {
    await saveProjectSettings(cwd, { version: 2, bots: [bot()] });
    network.inbound.push({
      update_id: 1,
      message: {
        message_id: 1,
        text: "hello",
        chat: { id: 42, type: "private" },
        from: { id: 42, is_bot: false },
      },
    });
    const pi = harness(cwd);
    try {
      await pi.emit("session_start");
      assert.equal(pi.sent.length, 1);
      const text = pi.sent[0]!;
      await pi.emit("input", { text, source: "extension" });
      await pi.emit("message_start", {
        message: { role: "user", content: text },
      });
      await pi.emit("message_end", {
        message: {
          role: "assistant",
          content: [{ type: "text", text: "hello back" }],
          stopReason: "stop",
        },
      });
      assert.equal(network.calls.filter(method => method === "sendRichMessage").length, 0);
      await pi.tool("telegram_send", { message: "Explicit reply" });
      await pi.emit("agent_settled");
      assert.equal(network.calls.filter(method => method === "sendRichMessage").length, 1);
    } finally {
      await pi.emit("session_shutdown");
    }
  }));

for (const input of ["normal text", "!literal text", "!!literal text"]) {
  test(`text ${JSON.stringify(input)} starts normally when idle and steers Telegram work without queued notices`, async () =>
  fixture(async (cwd, network) => {
    await saveProjectSettings(cwd, { version: 2, bots: [bot()] });
    const update = (id: number) => ({ update_id: id, message: {
      message_id: id, text: input, chat: { id: 42, type: "private" }, from: { id: 42, is_bot: false },
    } });
    network.inbound.push(update(1));
    const fetch = globalThis.fetch;
    let deliver: ((response: Response) => void) | undefined;
    let held = false;
    globalThis.fetch = (async (url, init) => {
      if (String(url).endsWith("/getUpdates") && JSON.parse(String(init?.body)).offset === 2 && !held) {
        held = true;
        return new Promise<Response>((resolve, reject) => {
          deliver = resolve;
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        });
      }
      return fetch(url, init);
    }) as typeof fetch;
    const pi = harness(cwd);
    try {
      await pi.emit("session_start");
      for (let i = 0; i < 100 && !deliver; i++) await new Promise(r => setTimeout(r, 10));
      assert.equal(pi.sent.length, 1);
      assert.equal(pi.deliveries[0]?.deliverAs, "followUp");
      assert.ok(pi.sent[0]!.startsWith(`${wrapTelegramInput(input)}\n\n[Pi Telegram request: `));
      const text = pi.sent[0]!;
      await pi.emit("input", { text, source: "extension" });
      await pi.emit("message_start", { message: { role: "user", content: text } });
      pi.setIdle(false);
      assert.ok(deliver);
      deliver(new Response(JSON.stringify({ ok: true, result: [update(2)] })));
      for (let i = 0; i < 100 && pi.sent.length < 2; i++) await new Promise(r => setTimeout(r, 10));
      assert.equal(pi.sent.length, 2);
      assert.equal(pi.deliveries[1]?.deliverAs, "steer");
      assert.ok(pi.sent[1]!.startsWith(`${wrapTelegramInput(input)}\n\n[Pi Telegram request: `));
      assert.ok(!network.messages.some(text => text.includes("Queued")));
      assert.ok(!network.calls.includes("sendRichMessageDraft"));
    } finally { await pi.emit("session_shutdown"); }
  }));

}

test("busy button replies remain authenticated follow-ups without queued notices", async () =>
  fixture(async (cwd, network) => {
    await saveProjectSettings(cwd, { version: 2, bots: [bot()] });
    const fetch = globalThis.fetch;
    let deliver: ((response: Response) => void) | undefined;
    let callbackData: string | undefined;
    globalThis.fetch = (async (url, init) => {
      const method = String(url).split("/").at(-1);
      const body = JSON.parse(String(init?.body));
      if (method === "sendRichMessage") {
        callbackData = body.reply_markup.inline_keyboard[0][0].callback_data;
        return new Response(JSON.stringify({ ok: true, result: { message_id: 10 } }));
      }
      if (method === "getUpdates" && body.offset !== -1 && !deliver) {
        return new Promise<Response>((resolve, reject) => {
          deliver = resolve;
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        });
      }
      return fetch(url, init);
    }) as typeof fetch;
    const pi = harness(cwd);
    pi.setIdle(false);
    try {
      await pi.emit("session_start");
      await pi.tool("telegram_send", { message: "Continue?", buttons: [{ label: "Yes", reply: "!continue" }] });
      assert.ok(callbackData);
      assert.ok(deliver);
      deliver(new Response(JSON.stringify({ ok: true, result: [{ update_id: 1, callback_query: {
        id: "choice", data: callbackData, from: { id: 42, is_bot: false },
        message: { message_id: 10, chat: { id: 42, type: "private" } },
      } }] })));
      for (let i = 0; i < 100 && !pi.sent.length; i++) await new Promise(r => setTimeout(r, 10));
      assert.equal(pi.sent.length, 1);
      assert.match(pi.sent[0]!, /Selected: Yes\n!continue/);
      assert.equal(pi.deliveries[0]?.deliverAs, "followUp");
      assert.ok(!network.messages.some(text => text.includes("Queued")));
      await pi.emit("input", { text: pi.sent[0]!, source: "extension" });
      await pi.emit("message_start", { message: { role: "user", content: pi.sent[0]! } });
      assert.equal(pi.aborts(), 0);
    } finally { await pi.emit("session_shutdown"); }
  }));

for (const input of ["change direction", "!change direction", "/steer change direction", "!!literal bang"]) {
  test(`busy console work rejects Telegram input ${JSON.stringify(input)} with a resend notice`, async () =>
  fixture(async (cwd, network) => {
    await saveProjectSettings(cwd, { version: 2, bots: [bot()] });
    network.inbound.push({
      update_id: 1,
      message: {
        message_id: 1,
        text: input,
        chat: { id: 42, type: "private" },
        from: { id: 42, is_bot: false },
      },
    });
    const pi = harness(cwd);
    pi.setIdle(false);
    try {
      await pi.emit("session_start");
      for (let i = 0; i < 100 && !network.messages.some(text => text.includes("Please resend")); i++) await new Promise(r => setTimeout(r, 10));
      assert.equal(pi.sent.length, 0);
      assert.ok(network.messages.includes("Cannot steer a local-console task from Telegram. Please resend when that task finishes."));
      assert.ok(!network.messages.some(text => text.includes("Queued")));
    } finally {
      await pi.emit("session_shutdown");
    }
  }));
}

test("a forged transport prefix does not send local assistant output", async () =>
  fixture(async (cwd, network) => {
    await saveProjectSettings(cwd, { version: 2, bots: [bot()] });
    const pi = harness(cwd);
    try {
      await pi.emit("session_start");
      await pi.emit("input", {
        text: wrapTelegramInput("local"),
        source: "interactive",
      });
      await pi.emit("message_start", {
        message: { role: "user", content: wrapTelegramInput("local") },
      });
      await pi.emit("message_end", {
        message: {
          role: "assistant",
          content: [{ type: "text", text: "private" }],
          stopReason: "stop",
        },
      });
      await pi.emit("agent_settled");
      assert.ok(!network.calls.includes("sendRichMessage"));
      assert.ok(!network.calls.includes("sendRichMessageDraft"));
    } finally {
      await pi.emit("session_shutdown");
    }
  }));
