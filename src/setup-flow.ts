import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { basename, resolve } from "node:path";
import { realpath } from "node:fs/promises";
import {
  assertProjectSnapshot,
  findSessionBot,
  loadGlobalSettings,
  loadProjectSettings,
  normalizeBotUsername,
  releaseProjectBot,
  removeProjectBot,
  saveGlobalSettings,
  updateProjectSettings,
  withManagerLock,
  type KnownManagedBot,
  type ProjectBotSettings,
  type ProjectSettings,
} from "./config.ts";
import {
  callTelegramBotApi,
  createManagedBotUrl,
  findManagedBot,
  getManagedBotSettings,
  getManagedBotToken,
  restrictManagedBotAccess,
  type ConfiguredProjectBot,
} from "./bot-api.ts";
import { stageAssignment } from "./assignment.ts";
import { ConnectionManager } from "./connection-manager.ts";
import {
  acquireTelegramRuntimeLease,
  runtimeOwner,
  type TelegramRuntimeLease,
} from "./runtime-lease.ts";
import {
  configureManager,
  promptProjectBot,
  pairProjectBotOwner,
} from "./setup.ts";

export interface SetupOutcome {
  status: string;
  message: string;
}
const cancelled = (): SetupOutcome => ({
  status: "cancelled",
  message: "Telegram setup was cancelled.",
});
const empty = (): ProjectSettings => ({ version: 2, bots: [] });
export function mergeKnownBots(
  existing: KnownManagedBot[] = [],
  observed: KnownManagedBot[],
): KnownManagedBot[] {
  const bots = new Map(existing.map((bot) => [bot.id, bot]));
  for (const bot of observed) {
    for (const [id, candidate] of bots) {
      if (
        id !== bot.id &&
        candidate.username.toLowerCase() === bot.username.toLowerCase()
      )
        bots.delete(id);
    }
    bots.set(bot.id, bot);
  }
  return [...bots.values()]
    .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt))
    .slice(0, 500);
}

export class SetupFlows {
  private busy = false;
  constructor(private readonly connections: ConnectionManager) {}

  async run(
    ctx: ExtensionContext,
    lifetime: AbortSignal,
    work: (signal: AbortSignal) => Promise<SetupOutcome>,
  ): Promise<SetupOutcome> {
    if (this.busy)
      throw new Error(
        "Another Telegram setup operation is already open in this session.",
      );
    if (ctx.mode !== "tui")
      throw new Error("Telegram setup requires the local interactive Pi UI.");
    const signal = AbortSignal.any([
      lifetime,
      ...(ctx.signal ? [ctx.signal] : []),
    ]);
    signal.throwIfAborted();
    this.busy = true;
    try {
      return await work(signal);
    } finally {
      this.busy = false;
    }
  }

  private async polling(
    ctx: ExtensionContext,
    token: string,
    signal: AbortSignal,
  ): Promise<void> {
    const info = await callTelegramBotApi<{ url: string }>(
      token,
      "getWebhookInfo",
      {},
      signal,
    );
    if (!info.url) return;
    if (
      !(await ctx.ui.confirm(
        "Remove the existing Telegram webhook?",
        "This stops webhook delivery to the other application so Pi can poll locally.",
        { signal },
      ))
    ) {
      throw new Error("Webhook takeover cancelled.");
    }
    signal.throwIfAborted();
    await callTelegramBotApi(
      token,
      "deleteWebhook",
      { drop_pending_updates: false },
      signal,
    );
  }

  async activate(
    bot: ConfiguredProjectBot,
    ctx: ExtensionContext,
    signal: AbortSignal,
    suppliedLease?: TelegramRuntimeLease,
    snapshot?: ProjectSettings,
  ): Promise<SetupOutcome> {
    const sessionId = ctx.sessionManager.getSessionId();
    const previous =
      snapshot ?? (await loadProjectSettings(ctx.cwd)) ?? empty();
    const existing = previous.bots.find((entry) => entry.id === bot.id);
    if (existing?.sessionId && existing.sessionId !== sessionId) {
      if (
        !(await ctx.ui.confirm(
          `Move @${bot.username} to this session?`,
          `Currently assigned to Pi session ${existing.sessionId}. The old session will disconnect.`,
          { signal },
        ))
      )
        return cancelled();
    }
    const old = findSessionBot(previous, sessionId);
    if (
      old &&
      old.id !== bot.id &&
      !(await ctx.ui.confirm(
        `Switch from @${old.username} to @${bot.username}?`,
        "The previous connection will be restored if the new connection fails and ownership has not changed.",
        { signal },
      ))
    )
      return cancelled();
    signal.throwIfAborted();
    const transaction = await stageAssignment(
      ctx.cwd,
      bot,
      sessionId,
      previous,
    );
    let lease = suppliedLease;
    let connected = false;
    try {
      // Stop only after confirmation and CAS. A same-bot token refresh also
      // restarts polling, instead of silently retaining old credentials.
      if (this.connections.bot?.id === bot.id)
        await this.connections.disconnect(ctx);
      lease ??= await acquireTelegramRuntimeLease(bot.id, sessionId, ctx.cwd, {
        waitMs: 12_000,
        signal,
      });
      if (!lease)
        throw new Error(
          "The bot is still polling in another process. Release it there and try again.",
        );
      const operationSignal = AbortSignal.any([
        signal,
        lease.signal,
        AbortSignal.timeout(30_000),
      ]);
      await this.polling(ctx, bot.token, operationSignal);
      operationSignal.throwIfAborted();
      await this.connections.disconnect(ctx);
      connected = await this.connections.connect(
        transaction.bot,
        ctx,
        signal,
        lease,
      );
      if (!connected) throw new Error("Telegram did not connect.");
      return {
        status: "connected",
        message: `Telegram started through @${bot.username}.`,
      };
    } catch (error) {
      if (lease) await lease.release();
      try {
        await transaction.rollback();
        if (old && !signal.aborted && !this.connections.connection)
          await this.connections.connect(old, ctx, signal);
      } catch {
        ctx.ui.notify(
          "Previous Telegram connection could not be restored. Assignments may have changed; use /telegram-status.",
          "warning",
        );
      }
      throw error;
    } finally {
      if (!connected) await lease?.release();
    }
  }

  private async pairAndActivate(
    identity: { id: string; username: string; token: string },
    managed: boolean,
    ctx: ExtensionContext,
    signal: AbortSignal,
  ): Promise<SetupOutcome> {
    const snapshot = (await loadProjectSettings(ctx.cwd)) ?? empty();
    const existing = snapshot.bots.find((bot) => bot.id === identity.id);
    // Already paired bots keep their trusted owner; changing that owner requires
    // explicitly removing the bot first. Never start a second pairing poll.
    if (existing)
      return this.activate(
        { ...existing, ...identity, managed },
        ctx,
        signal,
        undefined,
        snapshot,
      );
    if (
      !(await ctx.ui.confirm(
        `Pair @${identity.username}?`,
        "Pair the owner privately in Telegram. This requires exclusive polling access.",
        { signal },
      ))
    )
      return cancelled();
    const lease = await acquireTelegramRuntimeLease(
      identity.id,
      ctx.sessionManager.getSessionId(),
      ctx.cwd,
      { signal },
    );
    if (!lease)
      throw new Error(
        "This bot is already polling elsewhere. Release it before pairing.",
      );
    let transferred = false;
    try {
      const pairingSignal = AbortSignal.any([
        signal,
        lease.signal,
        AbortSignal.timeout(180_000),
      ]);
      await this.polling(ctx, identity.token, pairingSignal);
      const paired = await pairProjectBotOwner(
        ctx,
        identity.token,
        identity.username,
        pairingSignal,
      );
      signal.throwIfAborted();
      const outcome = await this.activate(
        { ...paired, managed },
        ctx,
        signal,
        lease,
        snapshot,
      );
      transferred = outcome.status === "connected";
      return outcome;
    } finally {
      if (!transferred) await lease.release();
    }
  }

  async manual(
    ctx: ExtensionContext,
    signal: AbortSignal,
  ): Promise<SetupOutcome> {
    const identity = await promptProjectBot(ctx, signal);
    if (!identity) return cancelled();
    return this.pairAndActivate(identity, false, ctx, signal);
  }

  private async manager(ctx: ExtensionContext, signal: AbortSignal) {
    const current = await loadGlobalSettings();
    if (current?.provisioningMode === "manager") return current.manager;
    const configured = await configureManager(ctx, signal);
    signal.throwIfAborted();
    return configured?.provisioningMode === "manager"
      ? configured.manager
      : undefined;
  }

  async completePending(ctx: ExtensionContext, signal: AbortSignal): Promise<SetupOutcome> {
    return this.managed(ctx, signal, true);
  }

  async managed(
    ctx: ExtensionContext,
    signal: AbortSignal,
    completeOnly = false,
  ): Promise<SetupOutcome> {
    const snapshot = await loadGlobalSettings();
    if (completeOnly && (snapshot?.provisioningMode !== "manager" || !snapshot.manager.pending))
      return { status: "none", message: "No managed-bot request is pending. Use /telegram-start to create one." };
    const initial = completeOnly && snapshot?.provisioningMode === "manager" ? snapshot.manager : await this.manager(ctx, signal);
    if (!initial) return cancelled();
    let pending = initial.pending;
    const projectPath = await realpath(ctx.cwd);
    const sessionId = ctx.sessionManager.getSessionId();
    if (pending?.sessionId && (pending.sessionId !== sessionId || pending.projectPath !== projectPath))
      return { status: "other_session", message: "This pending creation belongs to another project or Pi session. Complete it there, or cancel it explicitly before starting again." };
    if (pending && !pending.sessionId) {
      if (completeOnly) return { status: "legacy_pending", message: "This older pending request has no originating session. Use /telegram-start → Add a bot → Complete to confirm recovery locally." };
      if (!(await ctx.ui.confirm("Recover pending creation here?", `Complete @${pending.username} in this project and session?`, { signal }))) return cancelled();
    }
    if (!pending) {
      const username = await ctx.ui.input(
        "Exact username for the new bot",
        "@MyChosenBot",
        { signal },
      );
      if (!username?.trim()) return cancelled();
      const name = await ctx.ui.input(
        "Display name (empty uses project name)",
        basename(resolve(ctx.cwd)),
        { signal },
      );
      if (name === undefined) return cancelled();
      pending = {
        username: normalizeBotUsername(username),
        displayName: name.trim() || basename(resolve(ctx.cwd)),
        requestedAt: new Date().toISOString(),
        projectPath,
        sessionId,
      };
    }
    signal.throwIfAborted();
    const requested = pending;
    const result = await withManagerLock(async () => {
      const global = await loadGlobalSettings();
      if (
        global?.provisioningMode !== "manager" ||
        global.manager.id !== initial.id ||
        global.manager.token !== initial.token
      )
        throw new Error("Manager changed; start setup again.");
      if (
        JSON.stringify(global.manager.pending) !== JSON.stringify(initial.pending)
      )
        throw new Error("Pending creation changed; start setup again.");
      let manager = { ...global.manager, pending: requested };
      await saveGlobalSettings({ ...global, manager });
      await this.polling(
        ctx,
        manager.token,
        AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
      );
      const found = await findManagedBot(
        manager,
        requested.username,
        AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
      );
      signal.throwIfAborted();
      manager = {
        ...manager,
        updateOffset: found.nextOffset,
        knownBots: mergeKnownBots(manager.knownBots, found.observedBots),
      };
      if (found.settings) {
        const child = found.settings;
        // Persist credentials UNASSIGNED before acknowledging updates. Never use
        // a pending manager request as permission to transfer an existing bot.
        await updateProjectSettings(ctx.cwd, (settings) => {
          if (settings.bots.some((bot) => bot.id === child.id)) return settings;
          return {
            version: 2,
            bots: [...settings.bots, { ...child, sessionId: null }],
          };
        });
        const { pending: _pending, ...completed } = manager;
        await saveGlobalSettings({ ...global, manager: completed });
        return { bot: child };
      }
      await saveGlobalSettings({ ...global, manager });
      return {
        url: createManagedBotUrl(
          manager.username,
          requested.username,
          requested.displayName,
        ),
      };
    });
    if (result.bot) return this.activate(result.bot, ctx, signal);
    return {
      status: "pending",
      message: completeOnly
        ? "Still waiting for Telegram's creation update. Finish creation and press Start in Telegram, then say done again shortly."
        : `Approve creation in Telegram: ${result.url}\nCreate the bot and press Start, then tell this agent “done” to finish setup (or use /telegram-complete-setup).`,
    };
  }

  private async importKnown(
    bot: KnownManagedBot,
    ctx: ExtensionContext,
    signal: AbortSignal,
  ): Promise<SetupOutcome> {
    if (
      !(await ctx.ui.confirm(
        `Import @${bot.username}?`,
        "Retrieve its token through the manager and restrict access to its Telegram owner.",
        { signal },
      ))
    )
      return cancelled();
    const configured = await withManagerLock(async () => {
      const global = await loadGlobalSettings();
      if (global?.provisioningMode !== "manager")
        throw new Error("Manager is not configured.");
      const known = global.manager.knownBots?.find(
        (entry) => entry.id === bot.id,
      );
      if (!known) throw new Error("The manager catalog changed; start again.");
      return getManagedBotSettings(
        global.manager,
        known,
        AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
      );
    });
    return this.activate(configured, ctx, signal);
  }

  private async recover(
    ctx: ExtensionContext,
    signal: AbortSignal,
  ): Promise<SetupOutcome> {
    const manager = await this.manager(ctx, signal);
    if (!manager) return cancelled();
    const id = await ctx.ui.input("Telegram numeric bot ID", "123456789", {
      signal,
    });
    if (!id?.trim()) return cancelled();
    const username = await ctx.ui.input("Exact bot username", "@MyManagedBot", {
      signal,
    });
    if (!username?.trim()) return cancelled();
    if (
      !(await ctx.ui.confirm(
        `Recover @${normalizeBotUsername(username)}?`,
        "Retrieve its token and restrict access before private owner pairing.",
        { signal },
      ))
    )
      return cancelled();
    const identity = await withManagerLock(async () => {
      const current = await loadGlobalSettings();
      if (
        current?.provisioningMode !== "manager" ||
        current.manager.id !== manager.id
      )
        throw new Error("Manager changed; start recovery again.");
      const identity = await getManagedBotToken(
        current.manager,
        id.trim(),
        normalizeBotUsername(username),
        AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
      );
      await restrictManagedBotAccess(current.manager, identity.id, signal);
      return identity;
    });
    const outcome = await this.pairAndActivate(identity, true, ctx, signal);
    if (outcome.status === "connected") {
      const bot = this.connections.bot!;
      await withManagerLock(async () => {
        const global = await loadGlobalSettings();
        if (
          global?.provisioningMode !== "manager" ||
          global.manager.id !== manager.id
        )
          return;
        await saveGlobalSettings({
          ...global,
          manager: {
            ...global.manager,
            knownBots: mergeKnownBots(global.manager.knownBots, [
              {
                id: bot.id,
                username: bot.username,
                ownerUserId: bot.ownerUserId,
                lastSeenAt: new Date().toISOString(),
              },
            ]),
          },
        });
      }).catch(() =>
        ctx.ui.notify(
          "Connected; manager recovery catalog could not be updated.",
          "warning",
        ),
      );
    }
    return outcome;
  }

  async start(
    ctx: ExtensionContext,
    signal: AbortSignal,
  ): Promise<SetupOutcome> {
    const snapshot = (await loadProjectSettings(ctx.cwd)) ?? empty();
    const pendingGlobal = await loadGlobalSettings();
    const pending = pendingGlobal?.provisioningMode === "manager" ? pendingGlobal.manager.pending : undefined;
    const completeLabel = pending?.sessionId === ctx.sessionManager.getSessionId() && pending.projectPath === await realpath(ctx.cwd)
      ? `Complete @${pending.username}` : undefined;
    const choices = snapshot.bots.map(
      (bot) => `@${bot.username} — ${bot.sessionId ?? "unassigned"}`,
    );
    const choice = await ctx.ui.select(
      "Start Telegram",
      [...(completeLabel ? [completeLabel] : []), ...choices, "Add a bot…", "Manage bots…", "Cancel"],
      { signal },
    );
    if (completeLabel && choice === completeLabel) return this.completePending(ctx, signal);
    const index = choices.indexOf(choice ?? "");
    if (index >= 0)
      return this.activate(
        snapshot.bots[index]!,
        ctx,
        signal,
        undefined,
        snapshot,
      );
    if (choice === "Manage bots…") {
      const selected = await ctx.ui.select(
        "Manage Telegram",
        [
          "Status",
          "Release current bot",
          "Remove a bot",
          "Configure manager",
          "Cancel pending creation",
          "Recover by numeric ID",
          "Cancel",
        ],
        { signal },
      );
      if (selected === "Status") return this.status(ctx);
      if (selected === "Release current bot") return this.release(ctx);
      if (selected === "Remove a bot") return this.remove(ctx, signal);
      if (selected === "Recover by numeric ID")
        return this.recover(ctx, signal);
      if (selected === "Cancel pending creation")
        return this.cancelPending(ctx, signal);
      if (selected === "Configure manager") {
        const result = await configureManager(ctx, signal);
        return result
          ? {
              status: "configured",
              message: "Manager configured. Run /telegram-start to add a bot.",
            }
          : cancelled();
      }
      return cancelled();
    }
    if (choice !== "Add a bot…") return cancelled();
    const global = await loadGlobalSettings();
    const known =
      global?.provisioningMode === "manager"
        ? (global.manager.knownBots ?? []).filter(
            (bot) => !snapshot.bots.some((entry) => entry.id === bot.id),
          )
        : [];
    const labels = known.map((bot) => `Import @${bot.username}`);
    const managedLabel =
      global?.provisioningMode === "manager" && global.manager.pending
        ? `Complete @${global.manager.pending.username}`
        : "Create managed bot";
    const selected = await ctx.ui.select(
      "Add Telegram bot",
      ["Add BotFather bot", managedLabel, ...labels, "Cancel"],
      { signal },
    );
    if (selected === "Add BotFather bot") return this.manual(ctx, signal);
    if (selected === managedLabel) return this.managed(ctx, signal);
    const knownIndex = labels.indexOf(selected ?? "");
    return knownIndex >= 0
      ? this.importKnown(known[knownIndex]!, ctx, signal)
      : cancelled();
  }

  async release(ctx: ExtensionContext): Promise<SetupOutcome> {
    const sessionId = ctx.sessionManager.getSessionId();
    let settings: ProjectSettings | undefined;
    try {
      settings = await loadProjectSettings(ctx.cwd);
    } catch (error) {
      await this.connections.disconnect(ctx);
      throw error;
    }
    const bot = settings && findSessionBot(settings, sessionId);
    try {
      await this.connections.connection
        ?.sendPlainMessage(
          "Releasing Telegram from this Pi session.",
          AbortSignal.timeout(2_000),
        )
        .catch(() => undefined);
    } finally {
      await this.connections.disconnect(ctx);
    }
    if (!bot)
      return {
        status: "not_assigned",
        message: "No bot is assigned to this session.",
      };
    const released = await releaseProjectBot(ctx.cwd, bot.id, sessionId);
    return {
      status: released ? "released" : "assignment_changed",
      message: released
        ? `Released @${bot.username}; credentials are preserved.`
        : "Assignment changed; no other session was modified.",
    };
  }

  async remove(
    ctx: ExtensionContext,
    signal: AbortSignal,
  ): Promise<SetupOutcome> {
    const snapshot = (await loadProjectSettings(ctx.cwd)) ?? empty();
    const labels = snapshot.bots.map(
      (bot) => `@${bot.username} — ${bot.sessionId ?? "unassigned"}`,
    );
    const selected = await ctx.ui.select(
      "Remove project bot",
      [...labels, "Cancel"],
      { signal },
    );
    const bot = snapshot.bots[labels.indexOf(selected ?? "")];
    if (
      !bot ||
      !(await ctx.ui.confirm(
        `Remove @${bot.username}?`,
        "Delete its local credentials and assignment. This does not revoke or delete the Telegram bot.",
        { signal },
      ))
    )
      return cancelled();
    signal.throwIfAborted();
    await removeProjectBot(ctx.cwd, bot.id, snapshot);
    if (this.connections.bot?.id === bot.id) {
      try {
        await this.connections.connection
          ?.sendPlainMessage(
            "Removing this bot from the project.",
            AbortSignal.timeout(2_000),
          )
          .catch(() => undefined);
      } finally {
        await this.connections.disconnect(ctx);
      }
    }
    return {
      status: "removed",
      message: `Removed @${bot.username} from this project.`,
    };
  }

  async cancelPending(
    ctx: ExtensionContext,
    signal: AbortSignal,
  ): Promise<SetupOutcome> {
    const snapshot = await loadGlobalSettings();
    if (snapshot?.provisioningMode !== "manager" || !snapshot.manager.pending)
      return { status: "none", message: "No managed-bot request is pending." };
    if (
      !(await ctx.ui.confirm(
        `Cancel @${snapshot.manager.pending.username}?`,
        "Only the local request is cleared; no Telegram bot is deleted.",
        { signal },
      ))
    )
      return cancelled();
    return withManagerLock(async () => {
      signal.throwIfAborted();
      const current = await loadGlobalSettings();
      if (
        current?.provisioningMode !== "manager" ||
        JSON.stringify(current.manager.pending) !==
          JSON.stringify(snapshot.manager.pending) ||
        current.manager.id !== snapshot.manager.id
      )
        throw new Error("Pending request changed; review it again.");
      const { pending: _pending, ...manager } = current.manager;
      await saveGlobalSettings({ ...current, manager });
      return { status: "cancelled", message: "Pending creation cancelled." };
    });
  }

  async status(ctx: ExtensionContext): Promise<SetupOutcome> {
    const settings = (await loadProjectSettings(ctx.cwd)) ?? empty();
    const global = await loadGlobalSettings();
    const lines = [`Pi session: ${ctx.sessionManager.getSessionId()}`];
    for (const bot of settings.bots) {
      const owner = await runtimeOwner(bot.id);
      lines.push(
        `@${bot.username}: assigned to ${bot.sessionId ?? "nobody"}; ${this.connections.bot?.id === bot.id ? "connected here" : owner ? `polling process ${owner.pid}, session ${owner.sessionId}` : "not polling"}`,
      );
    }
    if (global?.provisioningMode === "manager" && global.manager.pending)
      lines.push(
        `Pending: @${global.manager.pending.username}; approve in Telegram, then say done in the initiating session or use /telegram-complete-setup.`,
      );
    if (!this.connections.connection)
      lines.push(
        "Next: /telegram-start to select a bot, or release it in the process currently polling.",
      );
    return { status: "status", message: lines.join("\n") };
  }
}
