import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { basename, resolve } from "node:path";
import { Type } from "typebox";

import { getTelegramPiConfigFilePath, loadTelegramPiConfig } from "./config.ts";
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
import {
  assertBindingMatchesBot,
  deriveBotUsername,
  getProjectBindingPath,
  loadProjectBinding,
  normalizeBotUsername,
  saveProjectBinding,
} from "./project-binding.ts";
import {
  getOrProvisionProjectBot,
  lookupProjectBot,
  lookupProjectBotByKey,
  type ProjectBot,
} from "./provisioner.ts";
import {
  isTelegramInput,
  routeTelegramInput,
  wrapTelegramInput,
} from "./routing.ts";
import {
  TelegramApiError,
  TelegramSessionConnection,
} from "./telegram.ts";

const STATUS_ID = "telegrampi";

export default function telegramPiExtension(pi: ExtensionAPI): void {
  let connection: TelegramSessionConnection | undefined;
  let connectedBot: ProjectBot | undefined;
  let lastDeliveredAssistantEntryId: string | undefined;
  let lastDeliveredAssistantTimestamp: number | undefined;
  let routeResponsesToTelegram = false;
  let lastStreamError: string | undefined;
  let outbound = Promise.resolve();

  const clearStatus = (ctx?: ExtensionContext) => {
    ctx?.ui.setStatus(STATUS_ID, undefined);
  };

  const connectReadyBot = async (
    bot: ProjectBot,
    ctx: ExtensionContext,
  ): Promise<boolean> => {
    if (connection) {
      if (connectedBot?.projectKey === bot.projectKey) return true;
      throw new Error("This Pi session is already connected to another Telegram bot.");
    }
    if (bot.status !== "ready" || !bot.token || !bot.ownerUserId) {
      throw new Error("The project bot is not ready.");
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
            projectName: bot.projectName,
            branch,
            ...host,
          });
        },
        () => {
          if (!ctx.isIdle()) return false;
          pi.sendUserMessage("/telegrampi-reload", {
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
        ctx.ui.theme.fg("success", `telegram: @${bot.botUsername}`),
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
            projectName: bot.projectName,
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
          const destination = bot.conversationUrl || `https://t.me/${bot.botUsername}`;
          ctx.ui.notify(
            `Telegram bot is ready. Open ${destination} and press Start.`,
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

  pi.on("session_start", async (_event, ctx) => {
    const latestAssistant = findLatestAssistantText(
      ctx.sessionManager.getBranch(),
    );
    lastDeliveredAssistantEntryId = latestAssistant?.entryId;
    lastDeliveredAssistantTimestamp = latestAssistant?.messageTimestamp;
    routeResponsesToTelegram = false;
    lastStreamError = undefined;
    if (ctx.mode === "print" || ctx.mode === "json") return;

    try {
      const config = await loadTelegramPiConfig();
      if (!config) return;

      const projectName = basename(resolve(ctx.cwd));
      const binding = await loadProjectBinding(ctx.cwd);
      const bot = binding
        ? await lookupProjectBotByKey(
            config,
            binding.projectKey,
            AbortSignal.timeout(10_000),
          )
        : await lookupProjectBot(
            config,
            projectName,
            AbortSignal.timeout(10_000),
          );
      if (binding) {
        if (!bot) {
          throw new Error(
            `The TelegramPi project binding at ${getProjectBindingPath(ctx.cwd)} was not found by the provisioner.`,
          );
        }
        assertBindingMatchesBot(binding, bot);
      }
      if (!bot || bot.status !== "ready") return;
      await connectReadyBot(bot, ctx);
    } catch (error) {
      connection = undefined;
      connectedBot = undefined;
      clearStatus(ctx);
      const message = error instanceof Error ? error.message : String(error);
      ctx.ui.notify(`TelegramPi did not connect: ${message}`, "warning");
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
    if (!routeResponsesToTelegram) return;
    await connection?.setDraftActivity(event.toolName);
  });

  pi.on("tool_execution_end", async () => {
    if (!routeResponsesToTelegram) return;
    await connection?.setDraftActivity();
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
    if (
      !current ||
      !routeResponsesToTelegram ||
      event.message.role !== "assistant"
    ) {
      return;
    }
    const text = extractPublicAssistantText(event.message);
    if (!text || event.message.timestamp === lastDeliveredAssistantTimestamp) {
      return;
    }

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

    if (event.message.stopReason !== "stop" && event.message.stopReason !== "length") {
      return;
    }
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

  pi.registerCommand("telegrampi-reload", {
    description: "Reload Pi resources after a Telegram /reload request",
    handler: async (_args, ctx) => {
      await ctx.reload();
      return;
    },
  });

  pi.registerTool({
    name: "telegram_create",
    label: "Show TelegramPi Config File",
    description:
      "Show the TelegramPi provisioner configuration file path so the extension can enable Telegram without Azure access.",
    promptSnippet: "Show the TelegramPi configuration file path when configuration is missing",
    promptGuidelines: [
      "Use telegram_create when telegram_enable reports missing TelegramPi user configuration and the user wants setup instructions.",
      "Tell the user or agent to update only the reported configuration file; never print or reveal keys.",
    ],
    parameters: Type.Object({}, { additionalProperties: false }),
    async execute() {
      const configPath = getTelegramPiConfigFilePath();
      const existing = await loadTelegramPiConfig().catch(() => undefined);
      if (existing) {
        return {
          content: [
            {
              type: "text",
              text: `TelegramPi configuration is already available at ${configPath}.`,
            },
          ],
          details: { status: "already_configured", configPath },
        };
      }

      return {
        content: [
          {
            type: "text",
            text: `TelegramPi needs configuration in this file, then run telegram_enable again:\n\n${configPath}`,
          },
        ],
        details: { status: "missing_config", configPath },
      };
    },
  });

  pi.registerTool({
    name: "telegram_enable",
    label: "Enable Telegram",
    description:
      "Enable Telegram integration for the current Pi project. Uses an existing .telegrampi.json binding or bot record; for a genuinely new project, returns the derived username and requires the user to choose it or provide a custom Telegram bot username before provisioning.",
    promptSnippet:
      "Enable the project-specific Telegram integration when the user requests it",
    promptGuidelines: [
      "Use telegram_enable when the user explicitly asks to enable or connect Telegram for the current project; never request, reveal, or manage Telegram credentials yourself.",
      "When telegram_enable returns username_choice_required, ask the user whether to use the suggested derived username or specify a custom username, then invoke telegram_enable again with that explicit choice. Never choose on the user's behalf.",
      "When the user explicitly requests a username, including while another username is pending, invoke telegram_enable with usernameChoice set to custom and botUsername set to the exact requested value.",
    ],
    parameters: Type.Object(
      {
        usernameChoice: Type.Optional(
          Type.Union([Type.Literal("derived"), Type.Literal("custom")], {
            description:
              "The user's explicit choice for first-time provisioning. Omit on the initial call.",
          }),
        ),
        botUsername: Type.Optional(
          Type.String({
            description:
              "Custom Telegram bot username when usernameChoice is custom.",
          }),
        ),
      },
      { additionalProperties: false },
    ),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      if (ctx.mode === "print" || ctx.mode === "json") {
        return {
          content: [
            {
              type: "text",
              text: "Telegram can only be enabled from a live interactive Pi session.",
            },
          ],
          details: { status: "unsupported_mode" },
        };
      }
      if (connection && connectedBot) {
        const binding = await saveProjectBinding(ctx.cwd, connectedBot);
        const bindingPath = getProjectBindingPath(ctx.cwd);
        const destination =
          connectedBot.conversationUrl || `https://t.me/${connectedBot.botUsername}`;
        return {
          content: [
            {
              type: "text",
              text: `Telegram is already enabled and connected through @${connectedBot.botUsername}. Open ${destination} and press Start if this is the bot's first session. Normal messages are follow-ups; prefix ! to steer active work, use !! for a literal leading !, and send stop to cancel the current Telegram task.`,
            },
          ],
          details: {
            status: "connected",
            botUsername: connectedBot.botUsername,
            conversationUrl: connectedBot.conversationUrl,
            projectKey: binding.projectKey,
            bindingPath,
          },
        };
      }

      const config = await loadTelegramPiConfig();
      if (!config) {
        throw new Error(
          `TelegramPi configuration is missing. Run telegram_create to get the configuration file path, update that file, then run telegram_enable again.`,
        );
      }
      const projectName = basename(resolve(ctx.cwd));
      const requestSignal = signal
        ? AbortSignal.any([signal, AbortSignal.timeout(20_000)])
        : AbortSignal.timeout(20_000);
      const bindingPath = getProjectBindingPath(ctx.cwd);
      const binding = await loadProjectBinding(ctx.cwd);
      let bot = binding
        ? await lookupProjectBotByKey(config, binding.projectKey, requestSignal)
        : await lookupProjectBot(config, projectName, requestSignal);
      if (binding) {
        if (!bot) {
          throw new Error(
            `The TelegramPi project binding at ${bindingPath} was not found by the provisioner.`,
          );
        }
        assertBindingMatchesBot(binding, bot);
      }

      const suggestedBotUsername = deriveBotUsername(
        projectName,
        config.botUsernamePrefix,
      );
      let selectedBotUsername: string | undefined;
      if (params.usernameChoice === "custom") {
        if (!params.botUsername?.trim()) {
          return {
            content: [
              {
                type: "text",
                text: "Ask the user for the custom Telegram bot username, then invoke telegram_enable again with usernameChoice set to custom and botUsername set to their answer.",
              },
            ],
            details: {
              status: "custom_username_required",
              projectName,
              suggestedBotUsername,
              bindingPath,
            },
          };
        }
        selectedBotUsername = normalizeBotUsername(params.botUsername);
      } else if (params.usernameChoice === "derived") {
        selectedBotUsername = suggestedBotUsername;
      }

      if (!bot && !selectedBotUsername) {
        return {
          content: [
            {
              type: "text",
              text: `No Telegram bot exists for ${projectName}. Ask the user whether to use the suggested username @${suggestedBotUsername} or specify a custom Telegram bot username. Then invoke telegram_enable again with usernameChoice set to derived or custom. Do not choose without the user's explicit answer.`,
            },
          ],
          details: {
            status: "username_choice_required",
            projectName,
            suggestedBotUsername,
            bindingPath,
          },
        };
      }

      if (
        bot &&
        selectedBotUsername &&
        bot.botUsername.toLowerCase() !== selectedBotUsername.toLowerCase()
      ) {
        if (bot.status !== "pending") {
          throw new Error(
            `Telegram is already enabled through ready bot @${bot.botUsername}; its username cannot be changed.`,
          );
        }
        bot = await getOrProvisionProjectBot(
          config,
          bot.projectName,
          selectedBotUsername,
          requestSignal,
        );
      } else if (!bot) {
        bot = await getOrProvisionProjectBot(
          config,
          projectName,
          selectedBotUsername,
          requestSignal,
        );
      }

      await saveProjectBinding(ctx.cwd, bot, {
        allowUsernameUpdate: bot.status === "pending",
      });

      if (bot.status === "pending") {
        const setup = bot.creationUrl
          ? ` Open ${bot.creationUrl} and approve creation, then ask the agent to enable Telegram again.`
          : " Complete bot creation through the Telegram setup bot, then ask the agent to enable Telegram again.";
        return {
          content: [
            {
              type: "text",
              text: `Telegram bot @${bot.botUsername} is awaiting owner confirmation.${setup}`,
            },
          ],
          details: {
            status: "pending",
            projectName,
            botUsername: bot.botUsername,
            creationUrl: bot.creationUrl,
            bindingPath,
          },
        };
      }

      const startupMessageDelivered = await connectReadyBot(bot, ctx);
      const destination = bot.conversationUrl || `https://t.me/${bot.botUsername}`;
      return {
        content: [
          {
            type: "text",
            text: startupMessageDelivered
              ? `Telegram is enabled for ${projectName} through @${bot.botUsername}. Future Telegram messages will enter this live Pi session. Normal messages are follow-ups; prefix ! to steer active work, use !! for a literal leading !, and send stop to cancel the current Telegram task.`
              : `Telegram is connected for ${projectName}, but Telegram requires the owner to initiate the new bot chat. Open ${destination}, press Start, and then send a message. The bot will explain follow-ups, ! steering, !! escaping, and stop.`,
          },
        ],
        details: {
          status: "connected",
          projectName,
          botUsername: bot.botUsername,
          conversationUrl: bot.conversationUrl,
          bindingPath,
        },
      };
    },
  });

  pi.registerTool({
    name: "telegram_send_file",
    label: "Send File to Telegram",
    description:
      "Send a file from the active project to the authorized Telegram owner as a native document. Available only while handling a Telegram-originated request. Paths outside the project and credential-like files are rejected.",
    promptSnippet:
      "Send requested project artifacts to Telegram as native document attachments",
    promptGuidelines: [
      "Use telegram_send_file during a Telegram-originated request when the user explicitly asks to receive a project file or when a requested generated artifact should be downloadable.",
      "Pass a path inside the active project. Never attempt to send credentials, local settings, private keys, repository internals, or files unrelated to the user's request.",
      "Do not use telegram_send_file for ordinary text responses; completed text is delivered through Telegram Rich Messages automatically.",
    ],
    parameters: Type.Object(
      {
        path: Type.String({
          minLength: 1,
          description:
            "Project-relative path, or an absolute path that still resolves inside the active project.",
        }),
        caption: Type.Optional(
          Type.String({
            maxLength: 1_024,
            description: "Optional plain-text Telegram document caption.",
          }),
        ),
      },
      { additionalProperties: false },
    ),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const current = connection;
      if (!current || !connectedBot) {
        throw new Error("Telegram is not connected for this Pi session.");
      }
      if (!routeResponsesToTelegram) {
        throw new Error(
          "Files can only be sent while handling a Telegram-originated request.",
        );
      }

      const file = await resolveTelegramProjectFile(ctx.cwd, params.path);
      await current.sendDocument(file, params.caption, signal);
      return {
        content: [
          {
            type: "text",
            text: `Sent ${file.fileName} to @${connectedBot.botUsername}.`,
          },
        ],
        details: {
          status: "sent",
          fileName: file.fileName,
          size: file.size,
          botUsername: connectedBot.botUsername,
        },
      };
    },
  });

  pi.registerCommand("telegram-status", {
    description: "Show the TelegramPi connection status for this session",
    handler: async (_args, ctx) => {
      if (connection && connectedBot) {
        ctx.ui.notify(`Connected to @${connectedBot.botUsername}`, "info");
      } else {
        ctx.ui.notify("Telegram is not connected for this session", "info");
      }
    },
  });
}
