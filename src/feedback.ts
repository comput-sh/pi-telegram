import { randomBytes } from "node:crypto";
import { abortable } from "./transport-queue.ts";
import { stableVersion } from "./updates.ts";

export const FEEDBACK_TTL = 15 * 60_000;
export const FEEDBACK_LIMIT = 2000;
export interface FeedbackOptions { endpoint: string; version: string }
interface Message {
  message_id: number; text?: string; chat: { id: number; type: string };
  from?: { id: number; is_bot: boolean }; forward_origin?: unknown;
  reply_to_message?: Message;
}
interface Query { id: string; data?: string; from: { id: number; is_bot: boolean }; message?: Message }
interface IO {
  request(method: string, body: Record<string, unknown>, signal: AbortSignal): Promise<{ message_id: number }>;
  effect(work: (signal: AbortSignal) => Promise<void>): Promise<void>;
  background(work: Promise<void>): void;
  cleanup(method: string, body: Record<string, unknown>): Promise<void>;
  notice(text: string): void;
  ack(id: string, text: string): void;
  signal: AbortSignal;
}
interface Flow {
  nonce: string; endpoint: string; expires: number; controller: AbortController; timer: NodeJS.Timeout;
  phase: "prompting" | "awaiting" | "previewing" | "preview" | "submitting";
  promptId?: number; previewId?: number; feedback?: string;
  promptCleanupQueued?: boolean; previewCleanupQueued?: boolean;
}
const PROMPT = "Pi Telegram feedback\nReply to this message with feedback (1–2000 characters). Do not include secrets, personal information, source code or transcripts. You will review it before submitting.";
const PREVIEW = "Pi Telegram feedback preview\n";
const marker = (kind: "prompt" | "preview", nonce: string) => `[Pi Telegram feedback ${kind}: ${nonce}]`;

export function feedbackEndpoint(endpoint?: string): string | undefined {
  if (endpoint === undefined) return undefined;
  let url: URL;
  try { url = new URL(endpoint); } catch { throw new Error("Invalid feedback endpoint."); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.href.length > 1024)
    throw new Error("Feedback endpoint must be HTTPS without credentials, query or fragment.");
  return url.href;
}

/** Explicit confirmed submission only. Never logs content or consumes a response body. */
export async function submitFeedback(endpoint: string, feedback: string, version: string, signal: AbortSignal): Promise<boolean> {
  const target = feedbackEndpoint(endpoint);
  if (!target || !feedback.trim() || feedback.length > FEEDBACK_LIMIT || !stableVersion(version)) throw new Error("Invalid feedback submission.");
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(10_000)]);
  try {
    deadline.throwIfAborted();
    const response = await abortable(fetch(target, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feedback, version }), signal: deadline, redirect: "error", credentials: "omit",
    }), deadline);
    // Headers are sufficient: a successful empty 200 is the complete service contract.
    void response.body?.cancel().catch(() => {});
    return response.status === 200;
  } catch { return false; }
}

/** Native feedback state is separate from agent questions and never becomes agent input. */
export class FeedbackFlow {
  private current?: Flow;
  private readonly known = new Set<number>();
  constructor(private readonly owner: number, private readonly botId: number | undefined, private readonly options: FeedbackOptions | undefined, private readonly io: IO) {}
  private live(flow: Flow): boolean { return this.current === flow && !flow.controller.signal.aborted && !this.io.signal.aborted && Date.now() < flow.expires; }
  private remember(id: number): void {
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error("Invalid feedback message identity.");
    this.known.add(id);
    if (this.known.size > 1000) this.known.delete(this.known.values().next().value!);
  }
  private actions(flow: Flow): Array<{ method: string; body: Record<string, unknown> }> {
    const actions: Array<{ method: string; body: Record<string, unknown> }> = [];
    if (flow.promptId && !flow.promptCleanupQueued) {
      flow.promptCleanupQueued = true;
      actions.push({ method: "deleteMessage", body: { chat_id: this.owner, message_id: flow.promptId } });
    }
    if (flow.previewId && !flow.previewCleanupQueued) {
      flow.previewCleanupQueued = true;
      actions.push({ method: "editMessageReplyMarkup", body: { chat_id: this.owner, message_id: flow.previewId, reply_markup: { inline_keyboard: [] } } });
    }
    return actions;
  }
  private retire(flow: Flow, closing = false): Promise<void> {
    if (this.current === flow) this.current = undefined;
    clearTimeout(flow.timer); flow.controller.abort();
    const actions = this.actions(flow);
    return Promise.all(actions.map(action => closing
      ? this.io.cleanup(action.method, action.body)
      : this.io.effect(signal => this.io.request(action.method, action.body, signal).then(() => {})))).then(() => {});
  }
  cancel(): void {
    const flow = this.current;
    if (!flow) return;
    void this.retire(flow);
    this.io.notice(flow.phase === "submitting" ? "Feedback submission interrupted. Delivery is unconfirmed; it will not be retried automatically." : "Feedback cancelled. Nothing was submitted.");
  }
  close(): Promise<void> { return this.current ? this.retire(this.current, true) : Promise.resolve(); }
  start(): void {
    let endpoint: string | undefined;
    try { endpoint = feedbackEndpoint(this.options?.endpoint); } catch { /* Unavailable before collecting anything. */ }
    if (!endpoint || !this.options || !stableVersion(this.options.version) || !Number.isSafeInteger(this.botId) || this.botId! <= 0) { this.io.notice("Feedback is not available in this installation yet."); return; }
    if (this.current?.phase === "submitting") { this.io.notice("Feedback submission is already in progress. Please wait for its result."); return; }
    if (this.current) void this.retire(this.current);
    const flow: Flow = { nonce: randomBytes(12).toString("hex"), endpoint, expires: Date.now() + FEEDBACK_TTL, controller: new AbortController(), phase: "prompting", timer: undefined! };
    flow.timer = setTimeout(() => {
      if (this.current !== flow) return;
      void this.retire(flow);
      this.io.notice(flow.phase === "submitting" ? "Feedback submission expired. Delivery is unconfirmed; no automatic retry." : "Feedback expired. Nothing was submitted. Use /feedback to start again.");
    }, FEEDBACK_TTL);
    flow.timer.unref?.(); this.current = flow;
    this.sendUI(flow, "prompting", async signal => {
      const sent = await this.io.request("sendMessage", {
        chat_id: this.owner, text: `${PROMPT}\n\n${marker("prompt", flow.nonce)}`,
        reply_markup: { force_reply: true, input_field_placeholder: "Write feedback (no secrets)" },
      }, signal);
      this.remember(sent.message_id); flow.promptId = sent.message_id;
      if (!this.live(flow)) { void this.retire(flow); return; }
      flow.phase = "awaiting";
    });
  }
  private sendUI(flow: Flow, phase: Flow["phase"], work: (signal: AbortSignal) => Promise<void>): void {
    const task = this.io.effect(async signal => {
      if (!this.live(flow) || flow.phase !== phase) return;
      await work(AbortSignal.any([signal, flow.controller.signal, this.io.signal]));
    }).catch(() => {}).finally(() => {
      if (this.current === flow && flow.phase === phase) {
        void this.retire(flow);
        this.io.notice("The feedback prompt could not be confirmed. Nothing was submitted. Use /feedback to try again.");
      }
    });
    this.io.background(task);
  }
  private recognized(reply: Message): boolean {
    if (reply.forward_origin || reply.chat.id !== this.owner || reply.chat.type !== "private") return false;
    if (!this.botId || reply.from?.id !== this.botId || !reply.from.is_bot) return false;
    if (this.known.has(reply.message_id)) return true;
    const text = reply.text ?? "";
    return (text.startsWith(`${PROMPT}\n\n`) && /^\[Pi Telegram feedback prompt: [a-f0-9]{24}\]$/.test(text.slice(PROMPT.length + 2)))
      || (text.startsWith(PREVIEW) && /\n\n\[Pi Telegram feedback preview: [a-f0-9]{24}\]$/.test(text));
  }
  reply(message: Message): boolean {
    if (message.chat.id !== this.owner || message.chat.type !== "private" || message.from?.id !== this.owner || message.from.is_bot || !message.reply_to_message || !this.recognized(message.reply_to_message)) return false;
    const flow = this.current;
    if (!flow || !this.live(flow) || flow.phase !== "awaiting" || message.reply_to_message.message_id !== flow.promptId) {
      this.io.notice("This feedback reply is no longer active. Use Submit/Cancel on the current preview, or /feedback to start again."); return true;
    }
    const text = message.text;
    if (typeof text !== "string" || !text.trim() || text.length > FEEDBACK_LIMIT) {
      this.io.notice("Reply with text only, between 1 and 2000 characters. Nothing was submitted."); return true;
    }
    flow.feedback = text; flow.phase = "previewing";
    this.sendUI(flow, "previewing", async signal => {
      const sent = await this.io.request("sendMessage", {
        chat_id: this.owner,
        text: `${PREVIEW}\n${text}\n\nSubmit sends only the feedback above and Pi Telegram version ${this.options!.version} to ${flow.endpoint}. Do not include secrets. No transcript or identity is attached automatically.\n\n${marker("preview", flow.nonce)}`,
        reply_markup: { inline_keyboard: [[{ text: "Submit", callback_data: `feedback:${flow.nonce}:submit` }, { text: "Cancel", callback_data: `feedback:${flow.nonce}:cancel` }]] },
      }, signal);
      this.remember(sent.message_id); flow.previewId = sent.message_id;
      if (!this.live(flow)) { void this.retire(flow); return; }
      flow.phase = "preview";
    });
    return true;
  }
  callback(query: Query): void {
    if (query.from.id !== this.owner || query.from.is_bot || query.message?.chat.id !== this.owner || query.message.chat.type !== "private") return;
    const flow = this.current;
    const action = query.data === `feedback:${flow?.nonce}:submit` ? "submit" : query.data === `feedback:${flow?.nonce}:cancel` ? "cancel" : undefined;
    if (!flow || !this.live(flow) || flow.phase !== "preview" || query.message.message_id !== flow.previewId || !action) { this.io.ack(query.id, "This feedback confirmation has expired or was already used."); return; }
    if (action === "cancel") { void this.retire(flow); this.io.ack(query.id, "Feedback cancelled; nothing submitted."); return; }
    flow.phase = "submitting"; // Consume consent before any asynchronous operation.
    this.io.ack(query.id, "Submitting feedback");
    for (const action of this.actions(flow)) void this.io.effect(signal => this.io.request(action.method, action.body, signal).then(() => {}));
    this.io.background((async () => {
      let accepted = false;
      try { accepted = await submitFeedback(flow.endpoint, flow.feedback!, this.options!.version, AbortSignal.any([flow.controller.signal, this.io.signal])); } catch { /* No details or feedback content in errors. */ }
      if (!this.live(flow)) return;
      void this.retire(flow);
      this.io.notice(accepted ? "Thank you — feedback submitted." : "Feedback delivery could not be confirmed. It may have arrived; no automatic retry was made.");
    })());
  }
}
