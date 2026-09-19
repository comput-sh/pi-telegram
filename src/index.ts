import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  findSessionBot,
  loadProjectSettings,
  saveGlobalSettings,
} from "./config.ts";
import { ConnectionManager } from "./connection-manager.ts";
import { registerResponseRouting } from "./request-routing.ts";
import { SetupFlows, type SetupOutcome } from "./setup-flow.ts";
import { configureManager } from "./setup.ts";
import { routeTelegramInput } from "./routing.ts";
import { resolveTelegramProjectFile } from "./files.ts";

export default function piTelegram(pi: ExtensionAPI): void {
  let lifetime = new AbortController();
  let activeContext: ExtensionContext | undefined;
  const responses = registerResponseRouting(pi, () => connections.connection);
  const connections = new ConnectionManager({
    async input({ text, forceSteer }, current, ctx) {
      const routed = forceSteer
        ? { text, deliverAs: "steer" as const }
        : routeTelegramInput(text);
      // Steering a console task must not cause its subsequent output to leak.
      if (
        routed.deliverAs === "steer" &&
        !ctx.isIdle() &&
        responses.destination() !== current
      ) {
        await current.sendPlainMessage(
          "Cannot steer a local-console task from Telegram. Send a normal message to queue a separate request.",
        );
        return;
      }
      const content = responses.origins.enqueue(routed.text, current);
      pi.sendUserMessage(content, { deliverAs: routed.deliverAs });
    },
    canStop: (current) =>
      responses.destination() === current &&
      !!activeContext &&
      !activeContext.isIdle(),
    stopTask: () => {
      responses.reset();
      activeContext?.abort();
    },
    disconnected: () => responses.reset(),
    reload: (ctx) => {
      if (!ctx.isIdle()) return false;
      pi.sendUserMessage("/pi-telegram-reload", {
        deliverAs: "followUp",
        expandPromptTemplates: true,
      });
      return true;
    },
  });
  const flows = new SetupFlows(connections);

  pi.on("session_start", async (_event, ctx) => {
    // Pi emits shutdown/start for new, resume, fork, and reload. A fresh
    // controller fences every setup operation to this specific runtime.
    lifetime.abort();
    await connections.disconnect(ctx);
    activeContext = ctx;
    lifetime = new AbortController();
    responses.reset();
    if (ctx.mode === "print" || ctx.mode === "json") return;
    try {
      const settings = await loadProjectSettings(ctx.cwd);
      const bot =
        settings && findSessionBot(settings, ctx.sessionManager.getSessionId());
      if (bot) await connections.connect(bot, ctx, lifetime.signal);
    } catch {
      await connections.disconnect(ctx);
      ctx.ui.notify(
        "Pi Telegram did not connect. Use /telegram-status or /telegram-start to inspect the assignment.",
        "warning",
      );
    }
  });
  pi.on("session_shutdown", async (_event, ctx) => {
    lifetime.abort(new Error("Pi session closed during Telegram setup."));
    activeContext = undefined;
    await connections.disconnect(ctx);
  });

  const run = (
    ctx: ExtensionContext,
    work: (signal: AbortSignal) => Promise<SetupOutcome>,
  ) => flows.run(ctx, lifetime.signal, work);
  const notify = (ctx: ExtensionContext, outcome: SetupOutcome) =>
    ctx.ui.notify(outcome.message, "info");
  pi.registerCommand("pi-telegram-reload", {
    description: "Reload Pi after a Telegram request",
    handler: async (_args, ctx) => {
      await ctx.reload();
    },
  });
  pi.registerCommand("telegram-start", {
    description: "Select or add a Telegram bot",
    handler: async (_args, ctx) =>
      notify(ctx, await run(ctx, (signal) => flows.start(ctx, signal))),
  });
  pi.registerCommand("telegram-release", {
    description: "Disconnect and unassign without deleting credentials",
    handler: async (_args, ctx) =>
      notify(ctx, await run(ctx, () => flows.release(ctx))),
  });
  pi.registerCommand("telegram-remove-bot", {
    description: "Remove a bot's local project credentials",
    handler: async (_args, ctx) =>
      notify(ctx, await run(ctx, (signal) => flows.remove(ctx, signal))),
  });
  pi.registerCommand("telegram-status", {
    description: "Show assignments, polling owners, and next steps",
    handler: async (_args, ctx) => notify(ctx, await flows.status(ctx)),
  });
  pi.registerCommand("telegram-setup-bot", {
    description: "Add a BotFather bot",
    handler: async (_args, ctx) =>
      notify(ctx, await run(ctx, (signal) => flows.manual(ctx, signal))),
  });
  pi.registerCommand("telegram-cancel-managed-bot", {
    description: "Cancel pending managed-bot creation",
    handler: async (_args, ctx) =>
      notify(ctx, await run(ctx, (signal) => flows.cancelPending(ctx, signal))),
  });
  pi.registerCommand("telegram-setup-manager", {
    description: "Configure the global manager",
    handler: async (_args, ctx) => {
      await run(ctx, async (signal) => {
        await configureManager(ctx, signal);
        return { status: "done", message: "Manager setup finished." };
      });
    },
  });
  pi.registerCommand("telegram-setup", {
    description: "Choose manual or managed provisioning",
    handler: async (_args, ctx) => {
      await run(ctx, async (signal) => {
        const choice = await ctx.ui.select(
          "Telegram provisioning",
          ["Manager", "Manual", "Cancel"],
          { signal },
        );
        signal.throwIfAborted();
        if (choice === "Manager") await configureManager(ctx, signal);
        if (choice === "Manual")
          await saveGlobalSettings({ version: 1, provisioningMode: "manual" });
        return { status: "done", message: "Setup finished." };
      });
    },
  });

  for (const name of ["telegram_start", "telegram_enable"]) {
    pi.registerTool({
      name,
      label: "Start Telegram",
      description:
        "Start Telegram through local selection, bot creation, import, or recovery. telegram_enable is an alias for telegram_start.",
      promptSnippet: "Start Telegram only on explicit user request",
      promptGuidelines: [
        "Use telegram_start or telegram_enable only when the user explicitly asks to start, connect, enable, select, create, or move Telegram for this Pi session.",
        "Never request or pass Telegram tokens in chat or tool arguments. Credentials are entered through masked local UI.",
      ],
      parameters: Type.Object({}, { additionalProperties: false }),
      async execute(_id, _params, _signal, _update, ctx) {
        const outcome = responses.destination()
          ? {
              status: "connected",
              message:
                "Telegram is already connected. Change bots through /telegram-start locally.",
            }
          : await run(ctx, (signal) => flows.start(ctx, signal));
        return {
          content: [{ type: "text", text: outcome.message }],
          details: outcome,
        };
      },
    });
  }
  pi.registerTool({
    name: "telegram_release",
    label: "Release Telegram",
    description:
      "Disconnect and clear only this Pi session's bot assignment; preserve credentials.",
    promptSnippet: "Release Telegram only on explicit user request",
    promptGuidelines: [
      "Use telegram_release only when explicitly asked to disconnect, release, or unassign Telegram from this Pi session.",
    ],
    parameters: Type.Object({}, { additionalProperties: false }),
    async execute(_id, _params, _signal, _update, ctx) {
      const outcome = await run(ctx, () => flows.release(ctx));
      return {
        content: [{ type: "text", text: outcome.message }],
        details: outcome,
      };
    },
  });
  pi.registerTool({
    name: "telegram_remove_bot",
    label: "Remove Telegram Bot",
    description:
      "Select and confirm deletion of a bot's local project credentials; does not delete or revoke the Telegram bot.",
    promptSnippet: "Remove a bot only on explicit user request",
    promptGuidelines: [
      "Use telegram_remove_bot only when explicitly asked to remove or forget a bot. Use telegram_release for disconnection without credential deletion.",
    ],
    parameters: Type.Object({}, { additionalProperties: false }),
    async execute(_id, _params, _signal, _update, ctx) {
      const outcome = responses.destination()
        ? {
            status: "local_confirmation_required",
            message:
              "Use /telegram-remove-bot locally to select and confirm removal.",
          }
        : await run(ctx, (signal) => flows.remove(ctx, signal));
      return {
        content: [{ type: "text", text: outcome.message }],
        details: outcome,
      };
    },
  });
  for (const photo of [false, true]) pi.registerTool({
    name: photo ? "telegram_send_photo" : "telegram_send_file",
    label: photo ? "Send Photo to Telegram" : "Send File to Telegram",
    description: photo
      ? "Send an explicitly requested project PNG/JPEG as an inline Telegram photo during a Telegram-originated request. Maximum 10 MB, width + height <= 10000, aspect ratio <= 20:1; caption <= 1024 characters. Telegram may resize/compress it. No automatic conversion, document fallback, or metadata removal. Credentials and repository internals are blocked."
      : "Send an explicitly requested safe project artifact to the Telegram owner during a Telegram-originated request. Maximum 50 MB; credentials and repository internals are blocked. Preserves original file bytes.",
    promptSnippet: photo ? "Send requested PNG/JPEG images as inline Telegram photos" : "Send requested project artifacts as native Telegram documents",
    promptGuidelines: [
      photo
        ? "Use telegram_send_photo for explicitly requested inline images during Telegram requests. Use telegram_send_file for original quality. Do not promise metadata removal or silently fall back to document delivery. Confirm sending only after tool success."
        : "Use telegram_send_file for requested downloadable project artifacts or original-quality images during Telegram requests, never for credentials, private settings, or ordinary text replies.",
    ],
    parameters: Type.Object(
      {
        path: Type.String({ minLength: 1 }),
        caption: Type.Optional(Type.String({ maxLength: 1_024 })),
      },
      { additionalProperties: false },
    ),
    async execute(_id, params, signal, _update, ctx) {
      const target = responses.destination();
      if (!target)
        throw new Error(
          "Files can only be sent for the current Telegram-originated request.",
        );
      const file = await resolveTelegramProjectFile(ctx.cwd, params.path);
      if (responses.destination() !== target)
        throw new Error("Telegram request destination changed.");
      if (photo) await target.sendPhoto(file, params.caption, signal);
      else await target.sendDocument(file, params.caption, signal);
      return {
        content: [{ type: "text", text: `Sent ${file.fileName} to Telegram.` }],
        details: { status: "sent", fileName: file.fileName, size: file.size },
      };
    },
  });
}
