import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { basename, resolve } from "node:path";
import { loadProjectSettings, type ProjectBotSettings } from "./config.ts";
import {
  acquireTelegramRuntimeLease,
  type TelegramRuntimeLease,
} from "./runtime-lease.ts";
import {
  TelegramSessionConnection,
  type TelegramInboundMessage,
} from "./telegram.ts";
import {
  formatSessionStartupMessage,
  formatSessionStatusMessage,
  getGitBranch,
  getHostIdentity,
} from "./host.ts";

export class ConnectionManager {
  connection?: TelegramSessionConnection;
  bot?: ProjectBotSettings;
  private lease?: TelegramRuntimeLease;
  private timer?: NodeJS.Timeout;
  private epoch = 0;
  constructor(
    private readonly callbacks: {
      input(
        message: TelegramInboundMessage,
        connection: TelegramSessionConnection,
        ctx: ExtensionContext,
      ): void | Promise<void>;
      canStop(connection: TelegramSessionConnection): boolean;
      stopTask(): void;
      disconnected(): void;
      reload(ctx: ExtensionContext): boolean;
      version?: string;
      connected?(connection: TelegramSessionConnection, ctx: ExtensionContext): void;
    },
  ) {}

  async disconnect(ctx?: ExtensionContext): Promise<void> {
    this.epoch++;
    const current = this.connection;
    const lease = this.lease;
    this.connection = undefined;
    this.bot = undefined;
    this.lease = undefined;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.callbacks.disconnected();
    ctx?.ui.setStatus("pi-telegram", undefined);
    try {
      await current?.stop();
    } finally {
      await lease?.release();
    }
  }

  async connect(
    bot: ProjectBotSettings,
    ctx: ExtensionContext,
    signal: AbortSignal,
    suppliedLease?: TelegramRuntimeLease,
  ): Promise<boolean> {
    signal.throwIfAborted();
    const sessionId = ctx.sessionManager.getSessionId();
    if (this.connection) {
      if (
        this.bot?.id === bot.id &&
        this.bot.sessionId === sessionId &&
        this.bot.token === bot.token
      )
        return true;
      throw new Error("This session already has a connected Telegram bot.");
    }
    const epoch = ++this.epoch;
    const lease =
      suppliedLease ??
      (await acquireTelegramRuntimeLease(bot.id, sessionId, ctx.cwd, {
        signal,
      }));
    if (!lease) {
      ctx.ui.setStatus(
        "pi-telegram",
        `telegram: @${bot.username} active elsewhere`,
      );
      return false;
    }
    const check = () => {
      signal.throwIfAborted();
      lease.signal.throwIfAborted();
      if (
        epoch !== this.epoch ||
        sessionId !== ctx.sessionManager.getSessionId()
      )
        throw new Error("Pi session changed during connection.");
    };
    const current: TelegramSessionConnection = new TelegramSessionConnection(
      bot.token,
      Number(bot.ownerUserId),
      {
        canStop: () =>
          this.connection === current && this.callbacks.canStop(current),
        onDraftError: () =>
          ctx.ui.notify(
            "Telegram draft delivery failed; check connectivity and Bot API support.",
            "warning",
          ),
      },
    );
    const stopOnAbort = () => {
      void current.stop();
    };
    signal.addEventListener("abort", stopOnAbort, { once: true });
    lease.signal.addEventListener("abort", stopOnAbort, { once: true });
    try {
      check();
      const saved = (await loadProjectSettings(ctx.cwd))?.bots.find(
        (entry) => entry.id === bot.id,
      );
      check();
      if (
        !saved ||
        saved.sessionId !== sessionId ||
        saved.token !== bot.token ||
        saved.ownerUserId !== bot.ownerUserId
      ) {
        throw new Error(
          "Telegram assignment or credentials changed before connection.",
        );
      }
      this.connection = current;
      this.bot = bot;
      this.lease = lease;
      await current.start(
        (message) =>
          this.connection === current
            ? this.callbacks.input(message, current, ctx)
            : undefined,
        () => {
          if (this.callbacks.canStop(current)) this.callbacks.stopTask();
        },
        async () =>
          formatSessionStatusMessage({
            projectName: basename(resolve(ctx.cwd)),
            branch: await getGitBranch(ctx.cwd),
            ...getHostIdentity(),
          }),
        () => this.connection === current && this.callbacks.reload(ctx),
      );
      // Attach immediately: menu/network work must not leave a rejected poll unhandled.
      void current.completion
        ?.catch(async () => {
          if (this.connection !== current) return;
          await this.disconnect(ctx);
          ctx.ui.notify(
            "Telegram disconnected; check connectivity or another polling process.",
            "warning",
          );
        })
        .catch(() =>
          ctx.ui.notify(
            "Telegram cleanup failed; inspect /telegram-status before reconnecting.",
            "warning",
          ),
        );
      check();
      let checking = false;
      this.timer = setInterval(() => {
        if (checking || this.connection !== current) return;
        checking = true;
        void (async () => {
          try {
            lease.signal.throwIfAborted();
            const configured = (await loadProjectSettings(ctx.cwd))?.bots.find(
              (entry) => entry.id === bot.id,
            );
            if (this.connection !== current) return;
            if (
              configured?.sessionId !== sessionId ||
              configured.token !== bot.token ||
              configured.ownerUserId !== bot.ownerUserId
            ) {
              throw new Error("Telegram assignment changed.");
            }
          } catch {
            if (this.connection === current) {
              await this.disconnect(ctx);
              ctx.ui.notify(
                "Telegram disconnected because ownership changed or could not be verified.",
                "warning",
              );
            }
          } finally {
            checking = false;
          }
        })().catch(() =>
          ctx.ui.notify(
            "Telegram ownership cleanup failed; inspect /telegram-status.",
            "warning",
          ),
        );
      }, 1_000);
      this.timer.unref?.();
      await current
        .configureCommandMenu()
        .catch(() =>
          ctx.ui.notify(
            "Telegram command menu could not be configured.",
            "warning",
          ),
        );
      check();
      ctx.ui.setStatus(
        "pi-telegram",
        ctx.ui.theme.fg("success", `telegram: @${bot.username}`),
      );
      await current
        .sendPlainMessage(
          formatSessionStartupMessage({
            version: this.callbacks.version,
            projectName: basename(resolve(ctx.cwd)),
            branch: await getGitBranch(ctx.cwd),
            ...getHostIdentity(),
          }),
        )
        .catch(() => {
          // Do not claim a successful reconnect when the owner never receives
          // its connection notice. Startup recovery will retry this assignment.
          throw new Error("Telegram connection notice could not be delivered.");
        });
      check();
      this.callbacks.connected?.(current, ctx);
      return true;
    } catch (error) {
      if (this.connection === current) await this.disconnect(ctx);
      else {
        try {
          await current.stop();
        } finally {
          await lease.release();
        }
      }
      throw error;
    } finally {
      signal.removeEventListener("abort", stopOnAbort);
      lease.signal.removeEventListener("abort", stopOnAbort);
    }
  }
}
