import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { basename, resolve } from "node:path";
import { Type } from "typebox";

import { createManagedBotUrl, findManagedBot } from "./bot-api.ts";
import {
  getGlobalSettingsPath,
  getProjectSettingsPath,
  loadGlobalSettings,
  loadProjectSettings,
  normalizeBotUsername,
  saveGlobalSettings,
  saveProjectSettings,
  withManagerLock,
  type GlobalSettings,
  type ProjectBotSettings,
} from "./config.ts";
import { resolveTelegramProjectFile } from "./files.ts";
import {
  formatSessionStartupMessage,
  formatSessionStatusMessage,
  getGitBranch,
  getHostIdentity,
} from "./host.ts";
import {
  extractPublicAssistantText,
  findLatestAssistantText,
  getPublicTextPhase,
} from "./messages.ts";
import { isTelegramInput, routeTelegramInput, wrapTelegramInput } from "./routing.ts";
import {
  configureManager,
  configureManualProjectBot,
  ensureInitialConfiguration,
} from "./setup.ts";
import { TelegramApiError, TelegramSessionConnection } from "./telegram.ts";

const STATUS_ID = "pi-telegram";
const PRODUCT_NAME = "Pi Telegram";

function projectName(cwd: string): string {
  return basename(resolve(cwd));
}

export default function piTelegram(pi: ExtensionAPI): void {
  let connection: TelegramSessionConnection | undefined;
  let connectedBot: ProjectBotSettings | undefined;
  let lastDeliveredAssistantEntryId: string | undefined;
  let lastDeliveredAssistantTimestamp: number | undefined;
  let routeResponsesToTelegram = false;
  let lastStreamError: string | undefined;
  let outbound = Promise.resolve();

  const clearStatus = (ctx?: ExtensionContext) => {
    ctx?.ui.setStatus(STATUS_ID, undefined);
  };

  const connectBot = async (
    bot: ProjectBotSettings,
    ctx: ExtensionContext,
  ): Promise<boolean> => {
    if (connection) {
      if (connectedBot?.id === bot.id) return true;
      throw new Error("This Pi session is already connected to another Telegram bot.");
    }
    const ownerUserId = Number(bot.ownerUserId);
    if (!Number.isSafeInteger(ownerUserId)) {
      throw new Error("The stored Telegram owner ID is invalid.");
    }

    const current = new TelegramSessionConnection(bot.token, ownerUserId);
    connection = current;
    connectedBot = bot;
    try {
      await current.start(
        ({ text, forceSteer }) => {
          if (connection !== current) return;
          try {
            const routed = forceSteer
              ? { text, deliverAs: "steer" as const }
              : routeTelegramInput(text);
            pi.sendUserMessage(wrapTelegramInput(routed.text), {
              deliverAs: routed.deliverAs,
            });
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            ctx.ui.notify(`Telegram message delivery failed: ${message}`, "warning");
          }
        },
        () => {
          routeResponsesToTelegram = false;
          ctx.abort();
          ctx.ui.notify("Generation stopped from Telegram", "info");
        },
        async () => {
          const host = getHostIdentity();
          const branch = await getGitBranch(ctx.cwd);
          return formatSessionStatusMessage({
            projectName: projectName(ctx.cwd),
            branch,
            ...host,
          });
        },
        () => {
          if (!ctx.isIdle()) return false;
          pi.sendUserMessage("/pi-telegram-reload", {
            deliverAs: "followUp",
            expandPromptTemplates: true,
          });
          return true;
        },
      );
      if (connection !== current) {
        await current.stop();
        return false;
      }

      try {
        await current.configureCommandMenu();
      } catch (error) {
        if (
          !(error instanceof TelegramApiError) ||
          error.errorCode !== 400 ||
          !/chat not found/i.test(error.message)
        ) {
          const message = error instanceof Error ? error.message : String(error);
          ctx.ui.notify(`Telegram command menu setup failed: ${message}`, "warning");
        }
      }

      ctx.ui.setStatus(
        STATUS_ID,
        ctx.ui.theme.fg("success", `telegram: @${bot.username}`),
      );
      current.completion?.catch((error: unknown) => {
        if (connection !== current) return;
        connection = undefined;
        connectedBot = undefined;
        clearStatus(ctx);
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`Telegram disconnected: ${message}`, "error");
      });

      const host = getHostIdentity();
      const branch = await getGitBranch(ctx.cwd);
      try {
        await current.sendPlainMessage(
          formatSessionStartupMessage({
            projectName: projectName(ctx.cwd),
            branch,
            ...host,
          }),
        );
        return true;
      } catch (error) {
        if (
          error instanceof TelegramApiError &&
          error.errorCode === 400 &&
          /chat not found/i.test(error.message)
        ) {
          ctx.ui.notify(
            `Telegram bot is ready. Open https://t.me/${bot.username} and press Start.`,
            "info",
          );
          return false;
        }
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`Telegram startup message failed: ${message}`, "warning");
        return false;
      }
    } catch (error) {
      if (connection === current) {
        connection = undefined;
        connectedBot = undefined;
        clearStatus(ctx);
      }
      await current.stop().catch(() => undefined);
      throw error;
    }
  };

  const clearCompletedManagerPending = async (
    bot: ProjectBotSettings,
  ): Promise<void> => {
    const settings = await loadGlobalSettings();
    if (
      settings?.provisioningMode !== "manager" ||
      settings.manager.pending?.username.toLowerCase() !== bot.username.toLowerCase()
    ) {
      return;
    }
    await withManagerLock(async () => {
      const current = await loadGlobalSettings();
      if (
        current?.provisioningMode !== "manager" ||
        current.manager.pending?.username.toLowerCase() !== bot.username.toLowerCase()
      ) {
        return;
      }
      const { pending: _completed, ...manager } = current.manager;
      await saveGlobalSettings({ ...current, manager });
    });
  };

  const replaceWithManualBot = async (
    ctx: ExtensionContext,
  ): Promise<ProjectBotSettings | undefined> => {
    const previousBot = connectedBot ?? (await loadProjectSettings(ctx.cwd));
    if (previousBot) {
      const confirmed = await ctx.ui.confirm(
        `Replace @${previousBot.username} for this project?`,
        "The current Telegram polling connection will stop while the replacement bot is validated and paired.",
      );
      if (!confirmed) return undefined;
    }

    const previousConnection = connection;
    if (previousConnection) {
      connection = undefined;
      connectedBot = undefined;
      clearStatus(ctx);
      await previousConnection.stop();
    }

    try {
      const replacement = await configureManualProjectBot(ctx);
      if (replacement) {
        await connectBot(replacement, ctx);
        return replacement;
      }
      if (previousBot && !connection) await connectBot(previousBot, ctx);
      return undefined;
    } catch (error) {
      if (previousBot && !connection) {
        await saveProjectSettings(ctx.cwd, previousBot).catch((restoreError) => {
          const message =
            restoreError instanceof Error ? restoreError.message : String(restoreError);
          ctx.ui.notify(`Previous Telegram settings could not be restored: ${message}`, "error");
        });
        await connectBot(previousBot, ctx).catch((reconnectError) => {
          const message =
            reconnectError instanceof Error
              ? reconnectError.message
              : String(reconnectError);
          ctx.ui.notify(`Previous Telegram bot could not reconnect: ${message}`, "warning");
        });
      }
      throw error;
    }
  };

  pi.on("session_start", async (_event, ctx) => {
    const latestAssistant = findLatestAssistantText(ctx.sessionManager.getBranch());
    lastDeliveredAssistantEntryId = latestAssistant?.entryId;
    lastDeliveredAssistantTimestamp = latestAssistant?.messageTimestamp;
    routeResponsesToTelegram = false;
    lastStreamError = undefined;
    if (ctx.mode === "print" || ctx.mode === "json") return;

    try {
      const configured = await ensureInitialConfiguration(ctx);
      if (configured.project) {
        await clearCompletedManagerPending(configured.project).catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          ctx.ui.notify(`Pending manager cleanup failed: ${message}`, "warning");
        });
        await connectBot(configured.project, ctx);
      }
    } catch (error) {
      connection = undefined;
      connectedBot = undefined;
      clearStatus(ctx);
      const message = error instanceof Error ? error.message : String(error);
      ctx.ui.notify(`${PRODUCT_NAME} did not connect: ${message}`, "warning");
    }
  });

  pi.on("before_agent_start", async (event) => {
    routeResponsesToTelegram = isTelegramInput(event.prompt);
    if (!routeResponsesToTelegram) await connection?.cancelRichDraft();
  });

  pi.on("message_start", async (event, ctx) => {
    if (event.message.role !== "user") return;
    routeResponsesToTelegram = isTelegramInput(event.message.content);
    if (!routeResponsesToTelegram) {
      await connection?.cancelRichDraft();
      return;
    }
    try {
      await connection?.beginRichDraft();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.ui.notify(`Telegram rich draft failed: ${message}`, "warning");
    }
  });

  pi.on("tool_execution_start", async (event) => {
    if (routeResponsesToTelegram) await connection?.setDraftActivity(event.toolName);
  });

  pi.on("tool_execution_end", async () => {
    if (routeResponsesToTelegram) await connection?.setDraftActivity();
  });

  pi.on("message_update", async (event, ctx) => {
    const current = connection;
    if (
      !current ||
      !routeResponsesToTelegram ||
      event.message.role !== "assistant" ||
      event.assistantMessageEvent.type !== "text_delta"
    ) {
      return;
    }

    const phase = getPublicTextPhase(event.message);
    const text = extractPublicAssistantText(event.message);
    if (!text) return;
    try {
      if (phase === "commentary") {
        await current.streamCommentaryDraft(text);
      } else if (
        phase === "final_answer" ||
        (phase === undefined && event.message.stopReason === "stop")
      ) {
        await current.streamRichDraft(text);
      } else {
        return;
      }
      lastStreamError = undefined;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message !== lastStreamError) {
        lastStreamError = message;
        ctx.ui.notify(`Telegram draft streaming failed: ${message}`, "warning");
      }
    }
  });

  pi.on("message_end", async (event, ctx) => {
    const current = connection;
    if (!current || !routeResponsesToTelegram || event.message.role !== "assistant") {
      return;
    }
    const text = extractPublicAssistantText(event.message);
    if (!text || event.message.timestamp === lastDeliveredAssistantTimestamp) return;

    if (event.message.stopReason === "toolUse") {
      outbound = outbound.then(async () => {
        if (connection !== current) return;
        try {
          await current.updateRichDraft(text);
          lastDeliveredAssistantTimestamp = event.message.timestamp;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          ctx.ui.notify(`Telegram progress delivery failed: ${message}`, "warning");
        }
      });
      await outbound;
      return;
    }

    if (event.message.stopReason !== "stop" && event.message.stopReason !== "length") return;
    outbound = outbound.then(async () => {
      if (connection !== current) return;
      try {
        await current.sendRichMessage(text);
        lastDeliveredAssistantTimestamp = event.message.timestamp;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`Telegram response delivery failed: ${message}`, "warning");
      }
    });
    await outbound;
  });

  pi.on("agent_settled", async (_event, ctx) => {
    const current = connection;
    const shouldSendResponse = routeResponsesToTelegram;
    routeResponsesToTelegram = false;
    if (!current) return;
    if (!shouldSendResponse) {
      await current.cancelRichDraft();
      return;
    }
    const assistant = findLatestAssistantText(ctx.sessionManager.getBranch());
    if (
      !assistant ||
      assistant.entryId === lastDeliveredAssistantEntryId ||
      assistant.messageTimestamp === lastDeliveredAssistantTimestamp
    ) {
      await current.cancelRichDraft();
      return;
    }

    outbound = outbound.then(async () => {
      if (connection !== current) return;
      try {
        await current.sendRichMessage(assistant.text);
        lastDeliveredAssistantEntryId = assistant.entryId;
        lastDeliveredAssistantTimestamp = assistant.messageTimestamp;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`Telegram response delivery failed: ${message}`, "warning");
      }
    });
    await outbound;
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    const current = connection;
    connection = undefined;
    connectedBot = undefined;
    routeResponsesToTelegram = false;
    lastStreamError = undefined;
    clearStatus(ctx);
    await current?.stop();
  });

  pi.registerCommand("pi-telegram-reload", {
    description: "Reload Pi resources after a Telegram /reload request",
    handler: async (_args, ctx) => {
      await ctx.reload();
    },
  });

  pi.registerCommand("telegram-setup", {
    description: "Choose manager or manual provisioning for Pi Telegram",
    handler: async (_args, ctx) => {
      const selected = await ctx.ui.select(
        "How should Pi Telegram configure project bots?",
        [
          "Use a Telegram manager bot",
          "I will provide each project bot manually",
        ],
      );
      if (selected === "Use a Telegram manager bot") {
        await configureManager(ctx);
      } else if (selected === "I will provide each project bot manually") {
        const settings: GlobalSettings = {
          version: 1,
          provisioningMode: "manual",
        };
        await saveGlobalSettings(settings);
        ctx.ui.notify(`Manual mode saved in ${getGlobalSettingsPath()}.`, "info");
        await replaceWithManualBot(ctx);
      }
    },
  });

  pi.registerCommand("telegram-setup-manager", {
    description: "Configure the global Telegram manager bot",
    handler: async (_args, ctx) => {
      await configureManager(ctx);
    },
  });

  pi.registerCommand("telegram-setup-bot", {
    description: "Configure a manually provisioned bot for this project",
    handler: async (_args, ctx) => {
      await replaceWithManualBot(ctx);
    },
  });

  pi.registerCommand("telegram-cancel-managed-bot", {
    description: "Cancel the globally pending managed-bot request",
    handler: async (_args, ctx) => {
      await withManagerLock(async () => {
        const settings = await loadGlobalSettings();
        if (!settings || settings.provisioningMode !== "manager") {
          ctx.ui.notify("Telegram manager mode is not configured.", "info");
          return;
        }
        if (!settings.manager.pending) {
          ctx.ui.notify("No managed-bot request is pending.", "info");
          return;
        }
        const confirmed = await ctx.ui.confirm(
          `Cancel setup for @${settings.manager.pending.username}?`,
          "This only clears Pi Telegram's local pending request. It does not delete a bot already created in Telegram.",
        );
        if (!confirmed) return;
        const { pending: _cancelled, ...manager } = settings.manager;
        await saveGlobalSettings({ ...settings, manager });
        ctx.ui.notify("Pending managed-bot setup cancelled.", "info");
      });
    },
  });

  pi.registerTool({
    name: "telegram_enable",
    label: "Enable Telegram",
    description:
      "Connect the current project bot. In manager mode, create or retrieve a managed bot using the exact username explicitly chosen by the user. Telegram credentials are configured only through local Pi setup commands.",
    promptSnippet: "Enable Telegram for the current project when the user requests it",
    promptGuidelines: [
      "Use telegram_enable only when the user explicitly asks to enable or connect Telegram for the current project.",
      "Never request, reveal, or pass Telegram bot tokens through tool arguments or chat.",
      "If the tool returns username_required, ask the user for the exact managed-bot username and call it again with botUsername. Never derive or choose a username from the project name.",
      "If manual setup is required, direct the user to run /telegram-setup-bot in the local Pi UI.",
    ],
    parameters: Type.Object(
      {
        botUsername: Type.Optional(
          Type.String({
            description:
              "Exact managed-bot username explicitly supplied by the user. Never derive one.",
          }),
        ),
        displayName: Type.Optional(
          Type.String({
            maxLength: 64,
            description: "Optional display name for a newly managed bot.",
          }),
        ),
      },
      { additionalProperties: false },
    ),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      if (ctx.mode === "print" || ctx.mode === "json") {
        return {
          content: [{ type: "text", text: "Telegram can only be enabled from a live interactive Pi session." }],
          details: { status: "unsupported_mode" },
        };
      }

      if (connection && connectedBot) {
        return {
          content: [
            {
              type: "text",
              text: `Telegram is already connected through @${connectedBot.username}. Open https://t.me/${connectedBot.username} and press Start if needed.`,
            },
          ],
          details: {
            status: "connected",
            botId: connectedBot.id,
            botUsername: connectedBot.username,
            settingsPath: getProjectSettingsPath(ctx.cwd),
          },
        };
      }

      const existing = await loadProjectSettings(ctx.cwd);
      if (existing) {
        await clearCompletedManagerPending(existing).catch(() => undefined);
        const delivered = await connectBot(existing, ctx);
        return {
          content: [
            {
              type: "text",
              text: delivered
                ? `Telegram is enabled through @${existing.username}.`
                : `Telegram is configured through @${existing.username}. Open https://t.me/${existing.username}, press Start, and send a message.`,
            },
          ],
          details: {
            status: "connected",
            botId: existing.id,
            botUsername: existing.username,
            settingsPath: getProjectSettingsPath(ctx.cwd),
          },
        };
      }

      const global = await loadGlobalSettings();
      if (!global) {
        return {
          content: [
            {
              type: "text",
              text: "Pi Telegram has not been configured. Run /telegram-setup in the local Pi UI. Tokens must not be sent through chat.",
            },
          ],
          details: { status: "setup_required", settingsPath: getGlobalSettingsPath() },
        };
      }
      if (global.provisioningMode === "manual") {
        return {
          content: [
            {
              type: "text",
              text: "This installation uses manually provisioned project bots. Run /telegram-setup-bot in the local Pi UI and enter the username and token there. Do not send the token through chat.",
            },
          ],
          details: {
            status: "manual_setup_required",
            settingsPath: getProjectSettingsPath(ctx.cwd),
          },
        };
      }

      if (!params.botUsername?.trim() && !global.manager.pending) {
        return {
          content: [
            {
              type: "text",
              text: "Ask the user for the exact Telegram bot username they want to create, then invoke telegram_enable again with that username. Do not derive or suggest a project-based username.",
            },
          ],
          details: { status: "username_required" },
        };
      }

      const requestedUsername = normalizeBotUsername(
        params.botUsername?.trim() || global.manager.pending!.username,
      );
      const requestSignal = signal
        ? AbortSignal.any([signal, AbortSignal.timeout(20_000)])
        : AbortSignal.timeout(20_000);
      const result = await withManagerLock(async () => {
        const lockedGlobal = await loadGlobalSettings();
        if (!lockedGlobal || lockedGlobal.provisioningMode !== "manager") {
          throw new Error("Telegram manager mode changed while provisioning.");
        }
        const existingPending = lockedGlobal.manager.pending;
        if (
          existingPending &&
          existingPending.username.toLowerCase() !== requestedUsername.toLowerCase()
        ) {
          return {
            conflict: existingPending.username,
          } as const;
        }

        const displayName =
          existingPending?.displayName ||
          params.displayName?.trim() ||
          projectName(ctx.cwd);
        const pending =
          existingPending ||
          ({
            username: requestedUsername,
            displayName,
            requestedAt: new Date().toISOString(),
          } as const);
        let manager = { ...lockedGlobal.manager, pending };
        if (!existingPending) {
          await saveGlobalSettings({
            ...lockedGlobal,
            manager,
          });
        }

        const managed = await findManagedBot(
          manager,
          requestedUsername,
          requestSignal,
        );
        manager = { ...manager, updateOffset: managed.nextOffset };
        if (!managed.settings) {
          await saveGlobalSettings({ ...lockedGlobal, manager });
          return {
            pending,
            creationUrl: createManagedBotUrl(
              manager.username,
              pending.username,
              pending.displayName,
            ),
          } as const;
        }

        // Persist the child token before confirming the Telegram update offset.
        // If the global write then fails, reprocessing the update is harmless.
        await saveProjectSettings(ctx.cwd, managed.settings);
        const { pending: _completed, ...managerWithoutPending } = manager;
        await saveGlobalSettings({
          ...lockedGlobal,
          manager: managerWithoutPending,
        });
        return { settings: managed.settings } as const;
      });

      if ("conflict" in result) {
        return {
          content: [
            {
              type: "text",
              text: `Manager provisioning is already waiting for @${result.conflict}. Complete that setup or run /telegram-cancel-managed-bot locally before choosing another username.`,
            },
          ],
          details: {
            status: "pending_username_conflict",
            pendingBotUsername: result.conflict,
          },
        };
      }
      if ("creationUrl" in result) {
        const pending = result.pending!;
        return {
          content: [
            {
              type: "text",
              text: `Managed bot @${pending.username} needs owner approval. Open ${result.creationUrl}, approve creation, then ask the agent to enable Telegram again.`,
            },
          ],
          details: {
            status: "pending",
            botUsername: pending.username,
            creationUrl: result.creationUrl,
          },
        };
      }

      const delivered = await connectBot(result.settings, ctx);
      return {
        content: [
          {
            type: "text",
            text: delivered
              ? `Telegram is enabled through managed bot @${result.settings.username}.`
              : `Telegram is configured through @${result.settings.username}. Open https://t.me/${result.settings.username}, press Start, and send a message.`,
          },
        ],
        details: {
          status: "connected",
          botId: result.settings.id,
          botUsername: result.settings.username,
          settingsPath: getProjectSettingsPath(ctx.cwd),
        },
      };
    },
  });

  pi.registerTool({
    name: "telegram_send_file",
    label: "Send File to Telegram",
    description:
      "Send a file from the active project to the authorized Telegram owner as a native document. Available only while handling a Telegram-originated request. Paths outside the project and credential-like files are rejected.",
    promptSnippet: "Send requested project artifacts to Telegram as native document attachments",
    promptGuidelines: [
      "Use telegram_send_file during a Telegram-originated request when the user explicitly asks to receive a project file or when a requested generated artifact should be downloadable.",
      "Pass a path inside the active project. Never attempt to send credentials, local settings, private keys, repository internals, or files unrelated to the user's request.",
      "Do not use telegram_send_file for ordinary text responses; completed text is delivered through Telegram Rich Messages automatically.",
    ],
    parameters: Type.Object(
      {
        path: Type.String({
          minLength: 1,
          description: "Project-relative path, or an absolute path that still resolves inside the active project.",
        }),
        caption: Type.Optional(
          Type.String({ maxLength: 1_024, description: "Optional plain-text Telegram document caption." }),
        ),
      },
      { additionalProperties: false },
    ),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const current = connection;
      if (!current || !connectedBot) throw new Error("Telegram is not connected for this Pi session.");
      if (!routeResponsesToTelegram) {
        throw new Error("Files can only be sent while handling a Telegram-originated request.");
      }
      const file = await resolveTelegramProjectFile(ctx.cwd, params.path);
      await current.sendDocument(file, params.caption, signal);
      return {
        content: [{ type: "text", text: `Sent ${file.fileName} to @${connectedBot.username}.` }],
        details: {
          status: "sent",
          fileName: file.fileName,
          size: file.size,
          botUsername: connectedBot.username,
        },
      };
    },
  });

  pi.registerCommand("telegram-status", {
    description: "Show the Pi Telegram connection status for this session",
    handler: async (_args, ctx) => {
      if (connection && connectedBot) {
        ctx.ui.notify(`Connected to @${connectedBot.username}`, "info");
      } else {
        ctx.ui.notify("Telegram is not connected for this session", "info");
      }
    },
  });
}
