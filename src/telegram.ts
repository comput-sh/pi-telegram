import { randomInt, randomBytes } from "node:crypto";
import { validateTelegramPhoto } from "./photos.ts";
import { INCOMING_FILE_LIMIT, type IncomingAttachment } from "./incoming-files.ts";

import {
  TELEGRAM_DOCUMENT_LIMIT,
  readTelegramProjectFile,
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
  "Pi Telegram controls",
  "",
  "Normal message: steer active Telegram work, or start a new turn when idle",
  "/steer message: explicitly steer active work",
  "Leading ! characters are literal text",
  "/status: show the connected Pi session",
  "/stop or stop: cancel the current Telegram task",
  "/reload: reload Pi resources when idle",
].join("\n");

const AI_ACTIONS = {
  thinking: {
    customEmojiId: "5535034915403333642",
    icon: "💭",
    label: "Thinking",
  },
  responding: {
    customEmojiId: "5573451671289200650",
    icon: "✍️",
    label: "Writing a response",
  },
  web: { customEmojiId: "5535365052359507996", icon: "🌐", label: "Browsing" },
  reading: {
    customEmojiId: "5537207975581581325",
    icon: "📖",
    label: "Reading files",
  },
  searching: {
    customEmojiId: "5534951812081123354",
    icon: "🔎",
    label: "Searching",
  },
  terminal: {
    customEmojiId: "5537514855289847815",
    icon: "🖥️",
    label: "Running a command",
  },
  editing: {
    customEmojiId: "5537247356136718385",
    icon: "✏️",
    label: "Editing files",
  },
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
  caption?: string;
  document?: { file_id: string; file_name?: string; file_size?: number };
  photo?: Array<{ file_id: string; file_size?: number; width: number; height: number }>;
  chat: { id: number; type: string };
  from?: { id: number; is_bot: boolean };
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: {
    id: string;
    from: { id: number; is_bot: boolean };
    data?: string;
    message?: TelegramMessage;
  };
}

export interface TelegramInboundMessage {
  text: string;
  messageId: number;
  forceSteer?: boolean;
  forceFollowUp?: boolean;
  attachment?: IncomingAttachment;
  downloadSignal?: AbortSignal;
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
  if (normalized.includes("browser") || normalized.includes("web"))
    return "web";
  if (normalized === "read") return "reading";
  if (
    normalized.includes("grep") ||
    normalized.includes("find") ||
    normalized.includes("search")
  ) {
    return "searching";
  }
  if (
    normalized === "bash" ||
    normalized.includes("shell") ||
    normalized.includes("powershell")
  ) {
    return "terminal";
  }
  if (
    normalized === "edit" ||
    normalized === "write" ||
    normalized.includes("code")
  ) {
    return "editing";
  }
  return "thinking";
}

function activityLabel(draft: ActiveDraft): string {
  const activity = AI_ACTIONS[draft.activity];
  return `${activity.label}${".".repeat((draft.heartbeat % 3) + 1)}`;
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
  const status = `\n\n${draft.activity === "thinking" ? "Working" : AI_ACTIONS[draft.activity].label}${".".repeat((draft.heartbeat % 3) + 1)}`;
  const content = draft.streamingText || "";
  if (content.length + status.length <= PLAIN_DRAFT_LIMIT) {
    return content + status;
  }
  const marker = "\n\n…preview truncated…";
  return (
    content.slice(0, PLAIN_DRAFT_LIMIT - marker.length - status.length) +
    marker +
    status
  );
}

function renderProgressLine(markdown: string): string {
  const line = markdown.replace(/\s+/g, " ").trim();
  if (line.length <= PROGRESS_LINE_LIMIT) return line;
  return `${line.slice(0, PROGRESS_LINE_LIMIT - 1).trimEnd()}…`;
}

function validateRichMarkdown(markdown: string): void {
  if (markdown.length > RICH_MESSAGE_LIMIT) {
    throw new Error(
      `Telegram Rich Markdown must not exceed ${RICH_MESSAGE_LIMIT} characters.`,
    );
  }
}

function validateQuestion(text: string, options: Array<{ label: string; reply: string }>): void {
  if (!text.trim() || text.length > 4096 || options.length < 1 || options.length > 8 ||
      options.some(option => !option.label.trim() || option.label.length > 64 || !option.reply.trim() || option.reply.length > 1024))
    throw new Error("Questions require 1–8 options, question <=4096 characters, labels <=64 and replies <=1024; values cannot be blank.");
  if (new Set(options.map(option => option.label.trim().toLowerCase())).size !== options.length)
    throw new Error("Question button labels must be distinct.");
}

export class TelegramSessionConnection {
  private readonly controller = new AbortController();
  private polling?: Promise<void>;
  private offset?: number;
  private activeDraft?: ActiveDraft;
  private draftWrites: Promise<void> = Promise.resolve();

  private incoming?: { controller: AbortController; task: Promise<void> };
  private lastDraftErrorAt = 0;

  async downloadIncomingFile(fileId: string, externalSignal: AbortSignal): Promise<Response> {
    const signal = AbortSignal.any([this.controller.signal, externalSignal]);
    signal.throwIfAborted();
    const file = await this.call<{ file_path?: string; file_size?: number }>("getFile", { file_id: fileId }, signal);
    if (file.file_size !== undefined && file.file_size > INCOMING_FILE_LIMIT)
      throw new Error("Incoming files must not exceed 20 MB.");
    const path = file.file_path;
    if (!path || !/^[a-zA-Z0-9_/-]+\.[a-zA-Z0-9]+$/.test(path) || path.startsWith("/") || path.split("/").some(part => part === ".." || part === "."))
      throw new Error("Telegram returned an invalid file download path.");
    try {
      const response = await fetch(`https://api.telegram.org/file/bot${this.token}/${path}`, { signal, redirect: "error" });
      if (!response.ok) throw new Error("download failed");
      return response;
    } catch { throw new Error("Telegram file download failed or was cancelled."); }
  }
  private question?: { nonce: string; messageId: number; text: string; options: Array<{ label: string; reply: string }>; expires: number; timer: NodeJS.Timeout };
  private outboundWrites: Promise<void> = Promise.resolve();
  private outboundDraft?: { id: number; text: string; heartbeat: number };

  private async writeOutboundDraft(draft: NonNullable<typeof this.outboundDraft>, signal: AbortSignal): Promise<void> {
    // Rich drafts animate too slowly on tested mobile clients. Keep the full
    // snapshot for prefix matching/finalization; bound only the plain preview.
    const suffix = "\n\n[Preview truncated]";
    const budget = 4096 - 3; // Reserve room for the changing heartbeat marker.
    const text = draft.text.length <= budget ? draft.text
      : draft.text.slice(0, budget - suffix.length).replace(/[\uD800-\uDBFF]$/, "") + suffix;
    await this.call("sendMessageDraft", {
      chat_id: this.ownerUserId, draft_id: draft.id,
      text: text + "\u200b".repeat((draft.heartbeat++ % 3) + 1),
    }, signal);
  }

  private async persistOutbound(text: string, signal: AbortSignal): Promise<void> {
    // Retire before sending: an uncertain delivery must not be automatically
    // replayed by a later status-only call or a new answer.
    this.outboundDraft = undefined;
    await this.call("sendRichMessage", { chat_id: this.ownerUserId, rich_message: { markdown: text } },
      AbortSignal.any([signal, AbortSignal.timeout(20_000)]));
  }
  private workingStatus?: { id: number; heartbeat: NodeJS.Timeout; expiry: NodeJS.Timeout; tick: number };

  private queueOutbound(work: () => Promise<void>): Promise<void> {
    const task = this.outboundWrites.then(work);
    this.outboundWrites = task.catch(() => undefined);
    return task;
  }

  private async clearWorkingStatus(): Promise<void> {
    const status = this.workingStatus;
    if (!status) return;
    clearInterval(status.heartbeat);
    clearTimeout(status.expiry);
    // Keep the ID if deletion fails so a later explicit send can retry cleanup.
    await this.call("deleteMessage", { chat_id: this.ownerUserId, message_id: status.id }, AbortSignal.timeout(2_000));
    if (this.workingStatus === status) this.workingStatus = undefined;
  }

  private async showWorkingStatus(signal: AbortSignal): Promise<void> {
    await this.clearWorkingStatus();
    signal.throwIfAborted();
    const sent = await this.call<TelegramMessage>("sendMessage", { chat_id: this.ownerUserId, text: "Working…", disable_notification: true }, signal);
    const status = { id: sent.message_id, tick: 0 } as NonNullable<typeof this.workingStatus>;
    this.workingStatus = status;
    // A separate removable status message avoids relying on draft expiry to
    // implement the user's explicit "omitted status means remove it" contract.
    status.heartbeat = setInterval(() => {
      void this.queueOutbound(async () => {
        if (this.workingStatus !== status || this.stopping) return;
        const signal = AbortSignal.timeout(5_000);
        if (this.outboundDraft) await this.writeOutboundDraft(this.outboundDraft, signal);
        await this.call("editMessageText", { chat_id: this.ownerUserId, message_id: status.id, text: `Working${".".repeat((++status.tick % 3) + 1)}` }, signal);
      }).catch(() => this.reportDraftError());
    }, 5_000);
    status.expiry = setTimeout(() => {
      clearInterval(status.heartbeat);
      void this.queueOutbound(async () => {
        if (this.workingStatus === status) {
          this.outboundDraft = undefined; // Expiry is not permission to publish unfinished text.
          await this.clearWorkingStatus();
        }
      }).catch(() => this.reportDraftError());
    }, 15 * 60_000);
    status.heartbeat.unref?.(); status.expiry.unref?.();
    if (signal.aborted || this.stopping) {
      await this.clearWorkingStatus().catch(() => undefined);
      throw new Error("Telegram status update was cancelled.");
    }
  }

  async sendOutbound(message?: string, status?: "working", buttons?: Array<{ label: string; reply: string }>, externalSignal?: AbortSignal): Promise<void> {
    if (message !== undefined) {
      if (!message.trim()) throw new Error("Telegram message cannot be blank.");
      validateRichMarkdown(message);
    }
    if (status !== undefined && status !== "working") throw new Error("Supported status: working. Omit status to remove it.");
    if (buttons && !message) throw new Error("Buttons require a message.");
    if (buttons) validateQuestion(message!, buttons);
    const signal = AbortSignal.any([this.controller.signal, ...(externalSignal ? [externalSignal] : [])]);
    await this.queueOutbound(async () => {
      signal.throwIfAborted();
      if (this.stopping) throw new Error("Telegram is disconnecting.");
      if (status === undefined || message !== undefined) await this.clearWorkingStatus();
      signal.throwIfAborted();
      const previous = this.outboundDraft;
      const extendsDraft = previous && message !== undefined && message.startsWith(previous.text);
      if (previous && message !== undefined && !extendsDraft)
        await this.persistOutbound(previous.text, signal);
      signal.throwIfAborted();
      if (buttons) {
        this.outboundDraft = undefined;
        await this.askQuestion(message!, buttons, signal);
      } else if (message !== undefined && status === "working") {
        const draft = { id: extendsDraft ? previous.id : randomInt(1, 2_147_483_647), text: message, heartbeat: extendsDraft ? previous.heartbeat : 0 };
        if (!extendsDraft || message !== previous.text)
          await this.writeOutboundDraft(draft, AbortSignal.any([signal, AbortSignal.timeout(20_000)]));
        signal.throwIfAborted();
        this.outboundDraft = draft;
      } else if (message !== undefined || (status === undefined && this.outboundDraft)) {
        await this.persistOutbound(message ?? this.outboundDraft!.text, signal);
      }
      signal.throwIfAborted();
      if (status === "working") await this.showWorkingStatus(AbortSignal.any([signal, AbortSignal.timeout(20_000)]));
    }).catch(() => { throw new Error("Telegram send/status could not be confirmed. Delivery may have occurred; check the chat before retrying."); });
  }

  private asking = false;
  private questionGeneration = 0;
  private stopping = false;

  async askQuestion(text: string, options: Array<{ label: string; reply: string }>, externalSignal?: AbortSignal): Promise<void> {
    validateQuestion(text, options);
    if (this.stopping) throw new Error("Telegram is disconnecting.");
    if (this.asking) throw new Error("Another Telegram question is being sent. Ask one question at a time.");
    const signal = AbortSignal.any([this.controller.signal, ...(externalSignal ? [externalSignal] : []), AbortSignal.timeout(20_000)]);
    signal.throwIfAborted();
    this.asking = true;
    try {
      const cleanup = this.expireQuestion();
      const generation = this.questionGeneration;
      await cleanup;
      signal.throwIfAborted();
      const nonce = randomBytes(12).toString("hex");
      const choices = options.map(option => ({ ...option }));
      const message = await this.call<TelegramMessage>("sendRichMessage", {
        chat_id: this.ownerUserId, rich_message: { markdown: text },
        reply_markup: { inline_keyboard: choices.map((option, index) => [{ text: option.label, callback_data: `ask:${nonce}:${index}` }]) },
      }, signal);
      if (generation !== this.questionGeneration || this.stopping || signal.aborted) {
        await this.call("editMessageReplyMarkup", { chat_id: this.ownerUserId, message_id: message.message_id, reply_markup: { inline_keyboard: [] } }, AbortSignal.timeout(2_000)).catch(() => undefined);
        throw new Error("Question was superseded or cancelled while sending; no buttons remain active.");
      }
      const timer = setTimeout(() => {
        if (this.question?.nonce === nonce) void this.expireQuestion().catch(() => undefined);
      }, 15 * 60_000);
      timer.unref?.();
      this.question = { nonce, messageId: message.message_id, text, options: choices, expires: Date.now() + 15 * 60_000, timer };
      if (signal.aborted) { await this.expireQuestion(); signal.throwIfAborted(); }
    } finally { this.asking = false; }
  }

  private async expireQuestion(): Promise<void> {
    this.questionGeneration++;
    const question = this.question;
    this.question = undefined;
    if (!question) return;
    clearTimeout(question.timer);
    await this.call("editMessageReplyMarkup", { chat_id: this.ownerUserId, message_id: question.messageId, reply_markup: { inline_keyboard: [] } }, AbortSignal.timeout(2_000)).catch(() => undefined);
  }

  private async handleQuestionButton(query: NonNullable<TelegramUpdate["callback_query"]>, onMessage: (message: TelegramInboundMessage) => void | Promise<void>): Promise<void> {
    if (query.from.id !== this.ownerUserId || query.from.is_bot || query.message?.chat.id !== this.ownerUserId || query.message.chat.type !== "private") return;
    const question = this.question;
    const index = question?.options.findIndex((_option, i) => query.data === `ask:${question.nonce}:${i}`) ?? -1;
    const valid = question && index >= 0 && question.messageId === query.message.message_id && Date.now() < question.expires;
    if (valid && this.incoming) {
      await this.call("answerCallbackQuery", { callback_query_id: query.id, text: "A file is downloading. Please choose again after it finishes." }, AbortSignal.timeout(5_000)).catch(() => undefined);
      return;
    }
    if (valid) { this.question = undefined; clearTimeout(question.timer); }
    await this.call("answerCallbackQuery", { callback_query_id: query.id, text: valid ? "Answer received" : "This question has expired or was already answered." }, AbortSignal.timeout(5_000)).catch(() => undefined);
    if (!valid || this.controller.signal.aborted) return;
    await this.call("editMessageReplyMarkup", { chat_id: this.ownerUserId, message_id: question.messageId, reply_markup: { inline_keyboard: [] } }, AbortSignal.timeout(2_000)).catch(() => undefined);
    if (this.controller.signal.aborted) return;
    const option = question.options[index]!;
    try {
      await onMessage({ text: `Answer to Telegram question:\n${question.text}\n\nSelected: ${option.label}\n${option.reply}`, messageId: question.messageId, forceFollowUp: true });
    } catch {
      // Never auto-retry: the callback may have been admitted before failing.
      await this.sendPlainMessage("Could not confirm delivery of your selection to the agent. Please check the conversation and type your answer if needed.").catch(() => undefined);
    }
  }

  private updateOffer?: { nonce: string; messageId: number; act: (approved: boolean) => void | Promise<void> };

  async offerUpdate(text: string, version: string, act: (approved: boolean) => void | Promise<void>): Promise<void> {
    const nonce = randomBytes(12).toString("hex");
    const message = await this.call<TelegramMessage>("sendMessage", {
      chat_id: this.ownerUserId, text,
      reply_markup: { inline_keyboard: [[
        { text: `Update to v${version}`, callback_data: `update:${nonce}:yes` },
        { text: "Not now", callback_data: `update:${nonce}:no` },
      ]] },
    }, this.controller.signal);
    this.updateOffer = { nonce, messageId: message.message_id, act };
  }

  private async handleUpdateButton(query: NonNullable<TelegramUpdate["callback_query"]>): Promise<void> {
    if (query.from.id !== this.ownerUserId || query.from.is_bot ||
        query.message?.chat.id !== this.ownerUserId || query.message.chat.type !== "private") return;
    const offer = this.updateOffer;
    const approved = query.data === `update:${offer?.nonce}:yes`;
    const valid = offer && query.message.message_id === offer.messageId &&
      (approved || query.data === `update:${offer.nonce}:no`);
    if (valid) this.updateOffer = undefined; // Consume before any await; duplicate clicks cannot reinstall.
    await this.call("answerCallbackQuery", {
      callback_query_id: query.id, text: valid ? (approved ? "Update approved" : "Update postponed") : "This update offer has expired.",
    }, this.controller.signal).catch(() => undefined);
    if (!valid) return;
    await this.call("editMessageReplyMarkup", { chat_id: this.ownerUserId, message_id: offer.messageId, reply_markup: { inline_keyboard: [] } }, this.controller.signal).catch(() => undefined);
    if (!this.controller.signal.aborted) await offer.act(approved);
  }

  constructor(
    private readonly token: string,
    private readonly ownerUserId: number,
    private readonly options: {
      canStop?: () => boolean;
      onDraftError?: () => void;
    } = {},
  ) {}

  private reportDraftError(): void {
    if (
      this.controller.signal.aborted ||
      Date.now() - this.lastDraftErrorAt < 30_000
    )
      return;
    this.lastDraftErrorAt = Date.now();
    this.options.onDraftError?.();
  }

  get completion(): Promise<void> | undefined {
    return this.polling;
  }

  async start(
    onMessage: (message: TelegramInboundMessage) => void | Promise<void>,
    onStopRequested: () => void,
    onStatusRequested: () => string | Promise<string>,
    onReloadRequested: () => boolean | Promise<boolean>,
  ): Promise<void> {
    const allowedUpdates = ["message", "callback_query"];
    const webhook = await this.call<{ url: string }>(
      "getWebhookInfo",
      {},
      AbortSignal.timeout(20_000),
    );
    if (webhook.url)
      throw new Error(
        "A Telegram webhook is configured. Run /telegram-start to confirm takeover.",
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
      { command: "help", description: "Show Pi Telegram controls" },
      { command: "status", description: "Show the connected Pi session" },
      { command: "steer", description: "Steer active work: /steer message" },
      { command: "stop", description: "Cancel the current Telegram task" },
      { command: "reload", description: "Reload Pi resources when idle" },
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
    this.stopping = true;
    this.outboundDraft = undefined;
    await this.clearWorkingStatus().catch(() => undefined);
    await this.expireQuestion();
    this.updateOffer = undefined;
    this.controller.abort();
    this.incoming?.controller.abort();
    await this.incoming?.task.catch(() => undefined);
    await this.outboundWrites;
    this.outboundDraft = undefined;
    if (this.workingStatus) { clearInterval(this.workingStatus.heartbeat); clearTimeout(this.workingStatus.expiry); this.workingStatus = undefined; }
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
    try {
      await this.writeDraft(draft);
    } finally {
      draft.refresh = this.refreshDraft(draft);
    }
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
    const firstPublicText = !draft.plain;
    draft.streamingText = markdown;
    draft.activity = "responding";
    draft.plain = true;
    if (firstPublicText) {
      if (draft.streamTimer) clearTimeout(draft.streamTimer);
      draft.streamTimer = undefined;
      await this.writeDraft(draft);
    } else this.scheduleDraftWrite(draft);
  }

  async updateRichDraft(markdown: string): Promise<void> {
    const draft = this.activeDraft;
    if (!draft) return;
    validateRichMarkdown(markdown);
    if (!markdown.trim()) return;
    draft.streamingText = markdown;
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
    if (activity === draft.activity) return;
    draft.activity = activity;
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

  async sendPlainMessage(
    text: string,
    externalSignal?: AbortSignal,
  ): Promise<void> {
    for (const chunk of splitTelegramText(text)) {
      await this.call(
        "sendMessage",
        { chat_id: this.ownerUserId, text: chunk },
        AbortSignal.any([
          AbortSignal.timeout(20_000),
          ...(externalSignal ? [externalSignal] : []),
        ]),
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

  async sendPhoto(file: TelegramProjectFile, caption?: string, signal?: AbortSignal): Promise<void> {
    await this.sendAttachment("photo", file, caption, signal);
  }

  async sendDocument(file: TelegramProjectFile, caption?: string, signal?: AbortSignal): Promise<void> {
    await this.sendAttachment("document", file, caption, signal);
  }

  private async sendAttachment(
    kind: "document" | "photo",
    file: TelegramProjectFile,
    caption?: string,
    externalSignal?: AbortSignal,
  ): Promise<void> {
    const signal = AbortSignal.any([
      this.controller.signal,
      ...(externalSignal ? [externalSignal] : []),
      AbortSignal.timeout(120_000),
    ]);
    signal.throwIfAborted();
    const normalizedCaption = validateDocumentCaption(caption);
    const bytes = await readTelegramProjectFile(file);
    signal.throwIfAborted();
    const contentType = kind === "photo" ? await validateTelegramPhoto(bytes) : file.contentType;
    signal.throwIfAborted();
    if (bytes.byteLength > TELEGRAM_DOCUMENT_LIMIT) {
      throw new Error("Telegram documents must not exceed 50 MB.");
    }

    const form = new FormData();
    form.set("chat_id", String(this.ownerUserId));
    form.set(
      kind,
      new Blob([new Uint8Array(bytes)], { type: contentType }),
      file.fileName,
    );
    if (normalizedCaption) form.set("caption", normalizedCaption);

    const method = kind === "photo" ? "sendPhoto" : "sendDocument";
    const response = await fetch(
      `https://api.telegram.org/bot${this.token}/${method}`,
      { method: "POST", body: form, signal },
    ).catch(() => {
      throw new Error(`Telegram ${kind} upload ${signal.aborted ? "cancelled or timed out" : "failed"}. Delivery is unconfirmed; check the chat before retrying.`);
    });
    await this.readResponse<TelegramMessage>(method, response);
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
      void this.writeDraft(draft).catch(() => this.reportDraftError());
    }, delay);
  }

  private async refreshDraft(draft: ActiveDraft): Promise<void> {
    while (
      !draft.controller.signal.aborted &&
      !this.controller.signal.aborted
    ) {
      await sleep(DRAFT_REFRESH_INTERVAL_MS, draft.controller.signal);
      if (draft.controller.signal.aborted || this.activeDraft !== draft) return;
      await this.writeDraft(draft).catch(() => this.reportDraftError());
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
          if (this.controller.signal.aborted) return;
          this.offset = update.update_id + 1;

          if (update.callback_query) {
            if (update.callback_query.data?.startsWith("ask:")) await this.handleQuestionButton(update.callback_query, onMessage);
            else await this.handleUpdateButton(update.callback_query);
            continue;
          }
          const message = update.message;
          if (
            !message ||
            message.chat.type !== "private" ||
            message.chat.id !== this.ownerUserId ||
            message.from?.id !== this.ownerUserId ||
            message.from.is_bot
          ) {
            continue;
          }
          const document = message.document;
          const photo = message.photo?.slice().sort((a, b) => a.width * a.height - b.width * b.height).at(-1);
          if (document || photo) {
            if (this.incoming) {
              await this.sendPlainMessage("A file is still downloading. Please resend this attachment after it finishes.");
              continue;
            }
            const attachment: IncomingAttachment = document
              ? { fileId: document.file_id, fileName: document.file_name || "document.bin", size: document.file_size, kind: "document" }
              : { fileId: photo!.file_id, fileName: "photo.jpg", size: photo!.file_size, kind: "photo" };
            const controller = new AbortController();
            const reception = { controller, task: Promise.resolve() };
            this.incoming = reception;
            reception.task = Promise.resolve().then(() => onMessage({
              text: message.caption || "", messageId: message.message_id, attachment,
              downloadSignal: AbortSignal.any([controller.signal, this.controller.signal, AbortSignal.timeout(120_000)]),
            })).catch(async () => {
              if (!this.controller.signal.aborted) await this.sendPlainMessage("File reception failed or was cancelled. Please resend the attachment.").catch(() => undefined);
            }).finally(() => { if (this.incoming === reception) this.incoming = undefined; });
            continue;
          }
          if (!message.text) {
            await this.sendPlainMessage("Send a document or photo to attach a file. Other incoming media types are not supported yet.");
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
            await this.expireQuestion();
            await onMessage({
              text: commandArgument,
              messageId: message.message_id,
              forceSteer: true,
            });
            continue;
          }
          if (commandName === "stop" || text.toLowerCase() === "stop") {
            await this.queueOutbound(async () => {
              this.outboundDraft = undefined;
              await this.clearWorkingStatus();
            }).catch(() => undefined);
            await this.expireQuestion();
            if (this.incoming) {
              this.incoming.controller.abort();
              await this.sendPlainMessage("File download cancellation requested.");
            } else if (this.options.canStop?.() ?? false) {
              await this.cancelRichDraft();
              onStopRequested();
            } else {
              await this.sendPlainMessage("Nothing is currently running.");
            }
            continue;
          }
          if (this.incoming) {
            await this.sendPlainMessage("A file is still downloading. Please resend your instruction after it finishes, or send /stop to cancel.");
            continue;
          }
          await this.expireQuestion(); // A typed answer supersedes pending buttons.
          await onMessage({
            text: message.text,
            messageId: message.message_id,
          });
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
        signal: AbortSignal.any([signal, this.controller.signal]),
      },
    ).catch(() => {
      throw new Error(`Telegram transport ${method} failed.`);
    });
    return this.readResponse<T>(method, response);
  }

  private async readResponse<T>(
    method: string,
    response: Response,
  ): Promise<T> {
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
