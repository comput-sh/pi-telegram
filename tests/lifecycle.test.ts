import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
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
  const sent: string[] = [];
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
    registerTool: () => {},
    sendUserMessage: (content: string) => {
      sent.push(content);
    },
  } as unknown as ExtensionAPI;
  extension(api);
  const emit = async (name: string, event: unknown = {}) => {
    for (const handler of events.get(name) ?? []) await handler(event, ctx);
  };
  return {
    ctx,
    sent,
    notices,
    choices,
    inputs,
    emit,
    command: (name: string) => commands.get(name)!("", ctx),
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
    failToken?: string;
    failMessages?: boolean;
    inbound: unknown[];
    managedUpdates?: unknown[];
  } = { calls: [], inbound: [] };
  globalThis.fetch = (async (url, init) => {
    const method = String(url).split("/").at(-1)!;
    network.calls.push(method);
    const body = JSON.parse(String(init?.body ?? "{}"));
    if (network.failToken && String(url).includes(network.failToken))
      throw new Error("network unavailable");
    const ok = (result: unknown) =>
      new Response(JSON.stringify({ ok: true, result }));
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
      const count = network.calls.length;
      await duplicate.emit("session_start", { reason: "resume" });
      assert.equal(network.calls.length, count);
      await duplicate.emit("session_shutdown");
      await main.emit("session_shutdown", { reason: "fork" });
      await fork.emit("session_start", { reason: "fork" });
      assert.equal(network.calls.length, count);
      await fork.emit("session_shutdown", { reason: "resume" });
      await main.emit("session_start", { reason: "resume" });
      assert.ok(network.calls.length > count);
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

test("a real inbound request routes through its receipt to the receiving bot", async () =>
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
      await pi.emit("agent_settled");
      assert.equal(
        network.calls.filter((method) => method === "sendRichMessage").length,
        1,
      );
    } finally {
      await pi.emit("session_shutdown");
    }
  }));

test("Telegram steering cannot turn a running console task into a Telegram request", async () =>
  fixture(async (cwd, network) => {
    await saveProjectSettings(cwd, { version: 2, bots: [bot()] });
    network.inbound.push({
      update_id: 1,
      message: {
        message_id: 1,
        text: "!change direction",
        chat: { id: 42, type: "private" },
        from: { id: 42, is_bot: false },
      },
    });
    const pi = harness(cwd);
    pi.setIdle(false);
    try {
      await pi.emit("session_start");
      assert.equal(pi.sent.length, 0);
    } finally {
      await pi.emit("session_shutdown");
    }
  }));

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
