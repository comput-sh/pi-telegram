import { randomInt } from "node:crypto";
import { readFile } from "node:fs/promises";

import {
  TELEGRAM_DOCUMENT_LIMIT,
  validateDocumentCaption,
  type TelegramProjectFile,
} from "./files.ts";
import { splitTelegramText } from "./messages.ts";

const RICH_MESSAGE_LIMIT = 32_768;
const PLAIN_DRAFT_LIMIT = 4_096;
const DRAFT_REFRESH_INTERVAL_MS = 5_000;
const DRAFT_STREAM_INTERVAL_MS = 1_500;
const PROGRESS_LINE_LIMIT = 512;
const TELEGRAM_HELP = [
  "Pi Telegram Extension controls",
  "",
  "Normal message: follow-up",
  "!message or /steer message: steer active work",
  "!!message: send a literal leading !",
  "/status: show the connected Pi session",
  "/stop or stop: cancel the current Telegram task",
  "/reload: reload Pi extensions when idle",
].join("\n");

const AI_ACTIONS = {
  thinking: { customEmojiId: "5535034915403333642", icon: "💭", label: "Thinking" },
  responding: { customEmojiId: "5573451671289200650", icon: "✍️", label: "Writing a response" },
  web: { customEmojiId: "5535365052359507996", icon: "🌐", label: "Browsing" },
  reading: { customEmojiId: "5537207975581581325", icon: "📖", label: "Reading files" },
  searching: { customEmojiId: "5534951812081123354", icon: "🔎", label: "Searching" },
  terminal: { customEmojiId: "5537514855289847815", icon: "🖥️", label: "Running a command" },
  editing: { customEmojiId: "5537247356136718385", icon: "✏️", label: "Editing files" },
} as const;

type DraftActivity = keyof typeof AI_ACTIONS;

interface TelegramApiEnvelope<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}

interface TelegramMessage {
  message_id: number;
  text?: string;
  chat: { id: number; type: string };
  from?: { id: number; is_bot: boolean };
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

export interface TelegramInboundMessage {
  text: string;
  messageId: number;
  forceSteer?: boolean;
}

export interface TelegramBotCommand {
  name: string;
  argument?: string;
}

export function parseTelegramBotCommand(
  text: string,
): TelegramBotCommand | undefined {
  const match = /^\/([a-z_]+)(?:@[a-z0-9_]+)?(?:\s+([\s\S]*))?$/i.exec(
    text.trim(),
  );
  if (!match?.[1]) return undefined;
  const argument = match[2]?.trim();
  return {
    name: match[1].toLowerCase(),
    ...(argument ? { argument } : {}),
  };
}

interface ActiveDraft {
  id: number;
  streamingText?: string;
  streamTimer?: NodeJS.Timeout;
  lastWriteAt: number;
  activity: DraftActivity;
  plain: boolean;
  heartbeat: number;
  controller: AbortController;
  refresh?: Promise<void>;
}

export class TelegramApiError extends Error {
  constructor(
    method: string,
    description: string,
    readonly errorCode?: number,
  ) {
    super(`Telegram API ${method} failed: ${description}`);
    this.name = "TelegramApiError";
  }
}

async function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(done, ms);
    const onAbort = () => {
      clearTimeout(timer);
      done();
    };
    function done() {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function activityForTool(toolName?: string): DraftActivity {
  if (!toolName) return "thinking";
  const normalized = toolName.toLowerCase();
  if (normalized === "responding") return "responding";
  if (normalized.includes("browser") || normalized.includes("web")) return "web";
  if (normalized === "read") return "reading";
  if (normalized.includes("grep") || normalized.includes("find") || normalized.includes("search")) {
    return "searching";
  }
  if (normalized === "bash" || normalized.includes("shell") || normalized.includes("powershell")) {
    return "terminal";
  }
  if (normalized === "edit" || normalized === "write" || normalized.includes("code")) {
    return "editing";
  }
  return "thinking";
}

function activityLabel(draft: ActiveDraft): string {
  const activity = AI_ACTIONS[draft.activity];
  return `${activity.label}${"\u2060".repeat((draft.heartbeat % 3) + 1)}`;
}

function renderInitialRichDraft(draft: ActiveDraft): Record<string, unknown> {
  const activity = AI_ACTIONS[draft.activity];
  return {
    blocks: [
      {
        type: "thinking",
        text: [
          {
            type: "custom_emoji",
            custom_emoji_id: activity.customEmojiId,
            alternative_text: activity.icon,
          },
          ` ${activityLabel(draft)}`,
        ],
      },
    ],
  };
}

function renderPlainDraft(draft: ActiveDraft): string {
  const heartbeat = "\u2060".repeat((draft.heartbeat % 3) + 1);
  const content = draft.streamingText || "";
  if (content.length + heartbeat.length <= PLAIN_DRAFT_LIMIT) {
    return content + heartbeat;
  }
  const marker = "\n\n…preview truncated…";
  return (
    content.slice(0, PLAIN_DRAFT_LIMIT - marker.length - heartbeat.length) +
    marker +
    heartbeat
  );
}

function renderProgressLine(markdown: string): string {
  const line = markdown.replace(/\s+/g, " ").trim();
  if (line.length <= PROGRESS_LINE_LIMIT) return line;
  return `${line.slice(0, PROGRESS_LINE_LIMIT - 1).trimEnd()}…`;
}

function validateRichMarkdown(markdown: string): void {
  if (markdown.length > RICH_MESSAGE_LIMIT) {
    throw new Error(`Telegram Rich Markdown must not exceed ${RICH_MESSAGE_LIMIT} characters.`);
  }
}

export class TelegramSessionConnection {
  private readonly controller = new AbortController();
  private polling?: Promise<void>;
  private offset?: number;
  private activeDraft?: ActiveDraft;
  private draftWrites: Promise<void> = Promise.resolve();

  constructor(
    private readonly token: string,
    private readonly ownerUserId: number,
  ) {}

  get completion(): Promise<void> | undefined {
    return this.polling;
  }

  async start(
    onMessage: (message: TelegramInboundMessage) => void | Promise<void>,
    onStopRequested: () => void,
    onStatusRequested: () => string | Promise<string>,
    onReloadRequested: () => boolean | Promise<boolean>,
  ): Promise<void> {
    const allowedUpdates = ["message"];
    await this.call<boolean>(
      "deleteWebhook",
      { drop_pending_updates: false },
      this.controller.signal,
    );
    const initial = await this.call<TelegramUpdate[]>(
      "getUpdates",
      { offset: -1, limit: 1, timeout: 0, allowed_updates: allowedUpdates },
      this.controller.signal,
    );
    const latest = initial.at(-1)?.update_id;
    if (latest !== undefined) this.offset = latest + 1;
    this.polling = this.poll(
      onMessage,
      onStopRequested,
      onStatusRequested,
      onReloadRequested,
      allowedUpdates,
    );
  }

  async configureCommandMenu(): Promise<void> {
    const commands = [
      { command: "help", description: "Show Pi Telegram Extension controls" },
      { command: "status", description: "Show the connected Pi session" },
      { command: "steer", description: "Steer active work: /steer message" },
      { command: "stop", description: "Cancel the current Telegram task" },
      { command: "reload", description: "Reload Pi extensions when idle" },
    ];
    try {
      await this.call<boolean>(
        "setMyCommands",
        {
          commands,
          scope: { type: "chat", chat_id: this.ownerUserId },
        },
        AbortSignal.timeout(20_000),
      );
    } catch (error) {
      if (
        !(error instanceof TelegramApiError) ||
        error.errorCode !== 400 ||
        !/chat not found/i.test(error.message)
      ) {
        throw error;
      }
      await this.call<boolean>(
        "setMyCommands",
        { commands },
        AbortSignal.timeout(20_000),
      );
    }
    await this.call<boolean>(
      "setChatMenuButton",
      {
        chat_id: this.ownerUserId,
        menu_button: { type: "commands" },
      },
      AbortSignal.timeout(20_000),
    );
  }

  async stop(): Promise<void> {
    this.controller.abort();
    await this.cancelRichDraft();
    await this.polling?.catch(() => undefined);
    this.polling = undefined;
  }

  async beginRichDraft(): Promise<void> {
    if (this.activeDraft) return;
    const draft: ActiveDraft = {
      id: randomInt(1, 2_147_483_647),
      lastWriteAt: 0,
      activity: "thinking",
      plain: false,
      heartbeat: 0,
      controller: new AbortController(),
    };
    this.activeDraft = draft;
    await this.writeDraft(draft);
    draft.refresh = this.refreshDraft(draft);
  }

  async streamCommentaryDraft(markdown: string): Promise<void> {
    const draft = this.activeDraft;
    if (!draft) return;
    validateRichMarkdown(markdown);
    const text = renderProgressLine(markdown);
    if (!text || text === draft.streamingText) return;
    draft.streamingText = text;
    draft.activity = "responding";
    draft.plain = true;
    this.scheduleDraftWrite(draft);
  }

  async streamRichDraft(markdown: string): Promise<void> {
    const draft = this.activeDraft;
    if (!draft) return;
    validateRichMarkdown(markdown);
    draft.streamingText = markdown;
    draft.activity = "responding";
    draft.plain = true;
    this.scheduleDraftWrite(draft);
  }

  async updateRichDraft(markdown: string): Promise<void> {
    const draft = this.activeDraft;
    if (!draft) return;
    validateRichMarkdown(markdown);
    const text = renderProgressLine(markdown);
    if (!text) return;
    draft.streamingText = text;
    draft.activity = "responding";
    draft.plain = true;
    if (draft.streamTimer) clearTimeout(draft.streamTimer);
    draft.streamTimer = undefined;
    await this.writeDraft(draft);
  }

  async setDraftActivity(toolName?: string): Promise<void> {
    const draft = this.activeDraft;
    if (!draft) return;
    const activity = activityForTool(toolName);
    if (activity === draft.activity && !draft.plain) return;
    draft.activity = activity;
    if (draft.plain) return;
    this.scheduleDraftWrite(draft);
  }

  async cancelRichDraft(): Promise<void> {
    const draft = this.activeDraft;
    this.activeDraft = undefined;
    if (!draft) return;
    if (draft.streamTimer) clearTimeout(draft.streamTimer);
    draft.streamTimer = undefined;
    draft.controller.abort();
    await draft.refresh?.catch(() => undefined);
    await this.draftWrites.catch(() => undefined);
  }

  async sendPlainMessage(text: string): Promise<void> {
    for (const chunk of splitTelegramText(text)) {
      await this.call(
        "sendMessage",
        { chat_id: this.ownerUserId, text: chunk },
        AbortSignal.timeout(20_000),
      );
    }
  }

  async sendRichMessage(markdown: string): Promise<void> {
    validateRichMarkdown(markdown);
    await this.cancelRichDraft();
    await this.call(
      "sendRichMessage",
      {
        chat_id: this.ownerUserId,
        rich_message: { markdown },
      },
      AbortSignal.timeout(20_000),
    );
  }

  async sendDocument(
    file: TelegramProjectFile,
    caption?: string,
    externalSignal?: AbortSignal,
  ): Promise<void> {
    const normalizedCaption = validateDocumentCaption(caption);
    const bytes = await readFile(file.path);
    if (bytes.byteLength > TELEGRAM_DOCUMENT_LIMIT) {
      throw new Error("Telegram documents must not exceed 50 MB.");
    }

    const form = new FormData();
    form.set("chat_id", String(this.ownerUserId));
    form.set(
      "document",
      new Blob([new Uint8Array(bytes)], { type: file.contentType }),
      file.fileName,
    );
    if (normalizedCaption) form.set("caption", normalizedCaption);

    const signal = AbortSignal.any([
      this.controller.signal,
      ...(externalSignal ? [externalSignal] : []),
      AbortSignal.timeout(120_000),
    ]);
    const response = await fetch(
      `https://api.telegram.org/bot${this.token}/sendDocument`,
      { method: "POST", body: form, signal },
    );
    await this.readResponse<TelegramMessage>("sendDocument", response);
  }

  private scheduleDraftWrite(draft: ActiveDraft): void {
    if (draft.streamTimer || draft.controller.signal.aborted) return;
    const delay = Math.max(
      0,
      DRAFT_STREAM_INTERVAL_MS - (Date.now() - draft.lastWriteAt),
    );
    draft.streamTimer = setTimeout(() => {
      draft.streamTimer = undefined;
      if (this.activeDraft !== draft || draft.controller.signal.aborted) return;
      void this.writeDraft(draft).catch(() => undefined);
    }, delay);
  }

  private async refreshDraft(draft: ActiveDraft): Promise<void> {
    while (!draft.controller.signal.aborted && !this.controller.signal.aborted) {
      await sleep(DRAFT_REFRESH_INTERVAL_MS, draft.controller.signal);
      if (draft.controller.signal.aborted || this.activeDraft !== draft) return;
      await this.writeDraft(draft).catch(() => undefined);
    }
  }

  private async writeDraft(draft: ActiveDraft): Promise<void> {
    const write = this.draftWrites.then(async () => {
      if (this.activeDraft !== draft || draft.controller.signal.aborted) return;
      draft.heartbeat += 1;
      const signal = AbortSignal.any([
        this.controller.signal,
        draft.controller.signal,
        AbortSignal.timeout(20_000),
      ]);
      if (draft.plain) {
        await this.call<boolean>(
          "sendMessageDraft",
          {
            chat_id: this.ownerUserId,
            draft_id: draft.id,
            text: renderPlainDraft(draft),
          },
          signal,
        );
      } else {
        await this.call<boolean>(
          "sendRichMessageDraft",
          {
            chat_id: this.ownerUserId,
            draft_id: draft.id,
            rich_message: renderInitialRichDraft(draft),
            can_stop: false,
          },
          signal,
        );
      }
      draft.lastWriteAt = Date.now();
    });
    this.draftWrites = write.catch(() => undefined);
    await write;
  }

  private async poll(
    onMessage: (message: TelegramInboundMessage) => void | Promise<void>,
    onStopRequested: () => void,
    onStatusRequested: () => string | Promise<string>,
    onReloadRequested: () => boolean | Promise<boolean>,
    allowedUpdates: string[],
  ): Promise<void> {
    while (!this.controller.signal.aborted) {
      try {
        const updates = await this.call<TelegramUpdate[]>(
          "getUpdates",
          {
            ...(this.offset !== undefined ? { offset: this.offset } : {}),
            limit: 10,
            timeout: 30,
            allowed_updates: allowedUpdates,
          },
          this.controller.signal,
        );
        for (const update of updates) {
          this.offset = update.update_id + 1;

          const message = update.message;
          if (
            !message?.text ||
            message.chat.type !== "private" ||
            message.chat.id !== this.ownerUserId ||
            message.from?.id !== this.ownerUserId ||
            message.from.is_bot
          ) {
            continue;
          }
          const text = message.text.trim();
          const command = parseTelegramBotCommand(text);
          const commandName = command?.name;
          const commandArgument = command?.argument;

          if (commandName === "start" || commandName === "help") {
            await this.configureCommandMenu().catch(() => undefined);
            await this.sendPlainMessage(TELEGRAM_HELP);
            continue;
          }
          if (commandName === "status") {
            await this.sendPlainMessage(await onStatusRequested());
            continue;
          }
          if (commandName === "reload") {
            if (!(await onReloadRequested())) {
              await this.sendPlainMessage(
                "Reload is unavailable while Pi is busy. Try /reload again after the current task finishes.",
              );
            }
            continue;
          }
          if (commandName === "steer") {
            if (!commandArgument) {
              await this.sendPlainMessage("Usage: /steer <message>");
              continue;
            }
            await onMessage({
              text: commandArgument,
              messageId: message.message_id,
              forceSteer: true,
            });
            continue;
          }
          if (commandName === "stop" || text.toLowerCase() === "stop") {
            if (this.activeDraft) {
              await this.cancelRichDraft();
              onStopRequested();
            } else {
              await this.sendPlainMessage("Nothing is currently running.");
            }
            continue;
          }
          await onMessage({ text: message.text, messageId: message.message_id });
        }
      } catch (error) {
        if (this.controller.signal.aborted) return;
        if (
          error instanceof TelegramApiError &&
          (error.errorCode === 409 || error.message.includes("Conflict"))
        ) {
          throw new Error(
            "Another Pi session is already polling this Telegram bot.",
            { cause: error },
          );
        }
        await sleep(3_000, this.controller.signal);
      }
    }
  }

  private async call<T>(
    method: string,
    body: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<T> {
    const response = await fetch(
      `https://api.telegram.org/bot${this.token}/${method}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal,
      },
    );
    return this.readResponse<T>(method, response);
  }

  private async readResponse<T>(method: string, response: Response): Promise<T> {
    let envelope: TelegramApiEnvelope<T> | undefined;
    try {
      envelope = (await response.json()) as TelegramApiEnvelope<T>;
    } catch {
      // Report a generic transport error without exposing the token-bearing URL.
    }
    if (!response.ok || !envelope?.ok || envelope.result === undefined) {
      throw new TelegramApiError(
        method,
        envelope?.description || `HTTP ${response.status}`,
        envelope?.error_code,
      );
    }
    return envelope.result;
  }
}
