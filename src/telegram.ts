import { randomInt, randomBytes } from "node:crypto";
import { validateTelegramPhoto } from "./photos.ts";
import { INCOMING_FILE_LIMIT, type IncomingAttachment } from "./incoming-files.ts";
import { TELEGRAM_DOCUMENT_LIMIT, readTelegramProjectFile, validateDocumentCaption, type TelegramProjectFile } from "./files.ts";
import { splitTelegramText } from "./messages.ts";
import { abortable, TransportQueue, TransportQueueError } from "./transport-queue.ts";
import { validateEmbeddedContent, type EmbeddedContent, type EmbeddedRichMessage, type PreparedEmbeddedContent } from "./rich-content.ts";

const TELEGRAM_HELP = ["Pi Telegram controls", "", "Normal message: steer active Telegram work, or start a new turn when idle", "/steer message: explicitly steer active work", "Leading ! characters are literal text", "/status: show the connected Pi session", "/stop or stop: cancel the current Telegram task and file download", "/reload: reload Pi resources when idle"].join("\n");
type Choices = Array<{ label: string; reply: string }>;
interface TelegramApiEnvelope<T> { ok: boolean; result?: T; description?: string; error_code?: number }
interface TelegramMessage {
  message_id: number; text?: string; caption?: string;
  document?: { file_id: string; file_name?: string; file_size?: number };
  photo?: Array<{ file_id: string; file_size?: number; width: number; height: number }>;
  chat: { id: number; type: string }; from?: { id: number; is_bot: boolean };
}
interface TelegramUpdate {
  update_id: number; message?: TelegramMessage;
  callback_query?: { id: string; from: { id: number; is_bot: boolean }; data?: string; message?: TelegramMessage };
}
export interface TelegramInboundMessage {
  text: string; messageId: number; forceSteer?: boolean; forceFollowUp?: boolean;
  attachment?: IncomingAttachment; downloadSignal?: AbortSignal;
}
export interface TelegramBotCommand { name: string; argument?: string }
export function parseTelegramBotCommand(text: string): TelegramBotCommand | undefined {
  const match = /^\/([a-z_]+)(?:@[a-z0-9_]+)?(?:\s+([\s\S]*))?$/i.exec(text.trim());
  if (!match?.[1]) return undefined;
  const argument = match[2]?.trim();
  return { name: match[1].toLowerCase(), ...(argument ? { argument } : {}) };
}
export class TelegramApiError extends Error {
  constructor(method: string, description: string, readonly errorCode?: number) {
    super(`Telegram API ${method} failed: ${description}`); this.name = "TelegramApiError";
  }
}
function validateRichMarkdown(message: string): void {
  if (!message.trim()) throw new Error("Telegram message cannot be blank.");
  if (message.length > 32_768) throw new Error("Telegram Rich Markdown must not exceed 32768 characters.");
}
function validateQuestion(text: string, options: Choices): void {
  if (!text.trim() || text.length > 4096 || options.length < 1 || options.length > 8 || options.some(o => !o.label.trim() || o.label.length > 64 || !o.reply.trim() || o.reply.length > 1024))
    throw new Error("Questions require 1–8 options, question <=4096 characters, labels <=64 and replies <=1024; values cannot be blank.");
  if (new Set(options.map(o => o.label.trim().toLowerCase())).size !== options.length) throw new Error("Question button labels must be distinct.");
}
async function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  await new Promise<void>(resolve => {
    const done = () => { clearTimeout(timer); signal.removeEventListener("abort", done); resolve(); };
    const timer = setTimeout(done, ms); signal.addEventListener("abort", done, { once: true });
  });
}
interface Draft { ref: string; id: number; text: string; tick: number; heartbeat: NodeJS.Timeout; expiry: NodeJS.Timeout; pending: boolean }
interface Working { id: number; tick: number; heartbeat: NodeJS.Timeout; expiry: NodeJS.Timeout; pending: boolean }
interface Thinking {
  ref: string; id: number; expires: number; schedule: AbortController; signal: AbortSignal;
  mode: "starting" | "refreshing" | "stopped" | "handoff";
  outcome: "none" | "confirmed" | "unknown"; inFlight?: Promise<void>; handoffIssued?: boolean;
}
type Input = (message: TelegramInboundMessage) => void | Promise<void>;

/** One connection-local communication engine. Ingress never awaits its outboxes. */
export class TelegramSessionConnection {
  private readonly controller = new AbortController();
  private operation = new AbortController();
  private readonly deliveries = new TransportQueue();
  private readonly effects = new TransportQueue({ depth: 32, residenceMs: 5_000, totalMs: 10_000 });
  private readonly callbacks = new TransportQueue({ depth: 16, residenceMs: 2_000, totalMs: 5_000 });
  private readonly tasks = new Set<Promise<unknown>>();
  private polling?: Promise<void>;
  private closing?: Promise<void>;
  private offset?: number;
  private stopping = false;
  private generation = 0;
  private lastDraftErrorAt = 0;
  private incoming?: { controller: AbortController; task: Promise<void> };
  private outboundDraft?: Draft;
  private workingStatus?: Working;
  private readonly statusCleanup = new Set<number>();
  private readonly messages = new Map<string, { id: number; buttons: boolean }>();
  private questionGeneration = 0;
  private question?: { nonce: string; messageId: number; text: string; options: Choices; expires: number; timer: NodeJS.Timeout; disabledRichMessage?: EmbeddedRichMessage };
  private updateGeneration = 0;
  private updateOffer?: { nonce: string; messageId: number; act: (approved: boolean) => void | Promise<void> };
  private menuPending?: Promise<void>;
  private statusPending = false;
  private chatActionRun?: { controller: AbortController; expires: number };
  private thinkingRun?: Thinking;
  private previewUncertain = false;
  private answerDraftStarts = 0;

  constructor(private readonly token: string, private readonly ownerUserId: number,
    private readonly options: { canStop?: () => boolean; onDraftError?: () => void } = {}) {}
  get completion(): Promise<void> | undefined { return this.polling; }
  private reportDraftError(): void {
    if (this.stopping || Date.now() - this.lastDraftErrorAt < 30_000) return;
    this.lastDraftErrorAt = Date.now();
    try { this.options.onDraftError?.(); } catch { /* A stale local UI must not reject background work. */ }
  }
  private track<T>(task: Promise<T>): Promise<T> {
    this.tasks.add(task);
    void task.then(() => this.tasks.delete(task), () => this.tasks.delete(task));
    return task;
  }
  private effect(work: (signal: AbortSignal) => Promise<void>, callback = false): Promise<void> {
    if (this.stopping) return Promise.resolve();
    return this.track((callback ? this.callbacks : this.effects).run(work, this.controller.signal)).catch(() => this.reportDraftError());
  }
  sendControlNotice(text: string): void { this.effect(signal => this.sendPlainMessage(text, signal)); }

  /** Native typing diagnostic only; independent of drafts, Working and delivery ordering. */
  async chatAction(action: "typing", refreshSeconds = 0, external?: AbortSignal): Promise<{ action: "typing"; refreshSeconds: number }> {
    if (action !== "typing") throw new Error("Only the typing chat action is supported.");
    if (!Number.isInteger(refreshSeconds) || refreshSeconds < 0 || refreshSeconds > 30)
      throw new Error("Chat action refreshSeconds must be an integer from 0 to 30.");
    const run = { controller: new AbortController(), expires: Date.now() + refreshSeconds * 1000 };
    const signal = AbortSignal.any([this.controller.signal, this.operation.signal, run.controller.signal, ...(external ? [external] : [])]);
    if (signal.aborted) throw new Error("Telegram typing action was cancelled before delivery.");
    this.chatActionRun?.controller.abort();
    this.chatActionRun = run;
    const pulse = async (budget: number) => {
      signal.throwIfAborted();
      if (this.chatActionRun !== run) throw new Error("Chat action was superseded.");
      const accepted = await this.call<boolean>("sendChatAction", { chat_id: this.ownerUserId, action: "typing" }, AbortSignal.any([signal, AbortSignal.timeout(Math.max(1, budget))]));
      signal.throwIfAborted();
      if (this.chatActionRun !== run || accepted !== true) throw new Error("Chat action was not confirmed.");
    };
    try {
      await this.track(pulse(refreshSeconds ? Math.min(5_000, Math.max(1, run.expires - Date.now())) : 5_000));
      if (refreshSeconds && Date.now() < run.expires) {
        // One loop, one pending request, no catch-up bursts. The clock starts at
        // invocation, not first acceptance. The caller returns after this first pulse.
        const refresh = (async () => {
          while (!signal.aborted && this.chatActionRun === run && Date.now() < run.expires) {
            await sleep(Math.min(4_000, run.expires - Date.now()), signal);
            if (signal.aborted || this.chatActionRun !== run || Date.now() >= run.expires) return;
            await pulse(Math.min(5_000, run.expires - Date.now()));
          }
        })();
        void this.track(refresh).catch(() => { if (!signal.aborted && this.chatActionRun === run) this.reportDraftError(); })
          .finally(() => { if (this.chatActionRun === run) this.chatActionRun = undefined; });
      } else if (this.chatActionRun === run) this.chatActionRun = undefined;
      return { action: "typing", refreshSeconds };
    } catch {
      run.controller.abort();
      if (this.chatActionRun === run) this.chatActionRun = undefined;
      throw new Error("Telegram typing action could not be confirmed or was cancelled. Visibility is not guaranteed; no automatic retry was made.");
    }
  }
  private cancelChatAction(): void {
    this.chatActionRun?.controller.abort(); this.chatActionRun = undefined;
  }

  private assertPreviewCertain(): void {
    if (this.previewUncertain) throw new TransportQueueError("Thinking refresh is stopped, but preview delivery is unknown. Reconnect to reset LOCAL preview state before creating another preview; reconnect cannot retract or prove the order of an earlier remote request. Posts and edits remain available.");
  }
  private thinkingActive(): boolean {
    const run = this.thinkingRun;
    return !!run && (run.mode !== "stopped" || !!run.inFlight);
  }
  private thinkingPulse(run: Thinking, budget: number): Promise<void> {
    let issued = false;
    const task = (async () => {
      run.signal.throwIfAborted();
      if (this.thinkingRun !== run) throw new Error("Thinking reference changed.");
      issued = true;
      const accepted = await this.call<boolean>("sendRichMessageDraft", {
        chat_id: this.ownerUserId, draft_id: run.id,
        rich_message: { blocks: [{ type: "thinking", text: "Thinking…" }] }, can_stop: false,
      }, AbortSignal.any([run.signal, AbortSignal.timeout(Math.max(1, budget))]));
      if (accepted !== true) throw new Error("Thinking pulse was not confirmed.");
      run.outcome = "confirmed";
    })().catch(error => {
      if (issued) { run.outcome = "unknown"; if (!this.stopping) this.previewUncertain = true; }
      throw error;
    }).finally(() => { if (run.inFlight === task) run.inFlight = undefined; });
    run.inFlight = task;
    return this.track(task);
  }
  private freezeThinking(run: Thinking): void {
    run.schedule.abort();
    if (run.mode !== "handoff") run.mode = "stopped";
  }
  /** Explicit generic Thinking lifecycle. Stop is local; handoff requires positive native ordering. */
  async thinking(action: "start" | "stop" | "handoff", options: { thinkingRef?: string; refreshSeconds?: number; message?: string }, external?: AbortSignal): Promise<{ thinkingRef?: string; draftRef?: string }> {
    if (!["start", "stop", "handoff"].includes(action)) throw new Error("Unknown Thinking action.");
    if (action === "start") {
      if (options.thinkingRef !== undefined || options.message !== undefined) throw new Error("Thinking start accepts only refreshSeconds.");
      const refreshSeconds = options.refreshSeconds ?? 30;
      if (!Number.isInteger(refreshSeconds) || refreshSeconds < 0 || refreshSeconds > 30) throw new Error("Thinking refreshSeconds must be an integer from 0 to 30.");
      this.assertPreviewCertain();
      if (this.outboundDraft || this.answerDraftStarts) throw new Error("An answer draft is active or starting.");
      if (this.thinkingActive()) throw new Error("Thinking is active or settling; stop it first, or hand it off using its reference.");
      const signal = AbortSignal.any([this.controller.signal, this.operation.signal, ...(external ? [external] : [])]);
      if (signal.aborted) throw new Error("Thinking was cancelled before delivery.");
      const run: Thinking = { ref: randomBytes(18).toString("base64url"), id: randomInt(1, 2_147_483_647), expires: Date.now() + refreshSeconds * 1000, schedule: new AbortController(), signal, mode: "starting", outcome: "none" };
      this.thinkingRun = run;
      try {
        await this.thinkingPulse(run, refreshSeconds ? Math.min(5_000, Math.max(1, run.expires - Date.now())) : 5_000);
        signal.throwIfAborted();
        if (this.thinkingRun !== run) throw new Error("Thinking reference changed.");
        if (refreshSeconds && Date.now() < run.expires && !run.schedule.signal.aborted) {
          run.mode = "refreshing";
          const scheduleSignal = AbortSignal.any([signal, run.schedule.signal]);
          const refresh = (async () => {
            while (!scheduleSignal.aborted && this.thinkingRun === run && Date.now() < run.expires) {
              await sleep(Math.min(4_000, run.expires - Date.now()), scheduleSignal);
              if (scheduleSignal.aborted || this.thinkingRun !== run || Date.now() >= run.expires) return;
              await this.thinkingPulse(run, Math.min(5_000, run.expires - Date.now()));
            }
          })();
          void this.track(refresh).catch(() => { if (!signal.aborted && this.thinkingRun === run) this.reportDraftError(); })
            .finally(() => { if (this.thinkingRun === run && run.mode === "refreshing") run.mode = "stopped"; });
        } else run.mode = "stopped";
        return { thinkingRef: run.ref };
      } catch {
        this.freezeThinking(run);
        if (this.thinkingRun === run && !this.previewUncertain) this.thinkingRun = undefined;
        this.assertPreviewCertain();
        throw new Error("Thinking was cancelled before a usable reference was established.");
      }
    }
    if (!options.thinkingRef || options.refreshSeconds !== undefined || (action === "stop" && options.message !== undefined)) throw new Error("Thinking stop/handoff requires thinkingRef; only handoff accepts message.");
    if (action === "handoff") { if (options.message === undefined) throw new Error("Thinking handoff requires a full message snapshot."); validateRichMarkdown(options.message); }
    const run = this.thinkingRun;
    if (!run || run.ref !== options.thinkingRef) throw new Error("Unknown or retired Thinking reference.");
    if (action === "stop") {
      this.freezeThinking(run); // Do not abort an issued pulse: its positive result is a future handoff barrier.
      this.assertPreviewCertain();
      return { thinkingRef: run.ref };
    }
    this.assertPreviewCertain();
    if (run.mode === "handoff") throw new Error("A handoff is already pending for this Thinking reference.");
    this.freezeThinking(run); run.mode = "handoff";
    let transmitted = false;
    let created: Draft | undefined;
    try {
      return await this.deliver(async signal => {
        if (run.inFlight) await abortable(run.inFlight, AbortSignal.any([signal, AbortSignal.timeout(5_000)]));
        signal.throwIfAborted(); this.assertPreviewCertain();
        if (this.thinkingRun !== run || run.outcome !== "confirmed") throw new TransportQueueError("Thinking handoff has no confirmed current preview; nothing was sent.");
        if (this.outboundDraft) throw new TransportQueueError("An answer draft is already active; nothing was sent.");
        // Only after the positive barrier: a new native ID explicitly replaces
        // the Thinking preview. Normal draft state/ref/timers use the same engine.
        transmitted = true; run.handoffIssued = true;
        created = await this.createAnswerDraft(options.message!, signal, run.id);
        if (this.thinkingRun === run) this.thinkingRun = undefined;
        return { draftRef: created.ref };
      }, external);
    } catch (error) {
      if (transmitted) {
        if (!this.stopping) this.previewUncertain = true;
        if (created && this.outboundDraft === created) this.retireDraft();
      }
      this.assertPreviewCertain();
      throw error;
    } finally { if (this.thinkingRun === run && run.mode === "handoff") run.mode = "stopped"; }
  }
  private cancelThinking(): void {
    const run = this.thinkingRun;
    if (run) {
      // Owner Stop aborts transport immediately. Fence synchronously before a
      // late rejected pulse/handoff continuation can run or another preview starts.
      if (!this.stopping && (run.inFlight || run.handoffIssued)) this.previewUncertain = true;
      this.freezeThinking(run);
    }
    this.thinkingRun = undefined;
  }
  private deliver<T>(work: (signal: AbortSignal) => Promise<T>, external?: AbortSignal): Promise<T> {
    const generation = this.generation;
    const signal = AbortSignal.any([this.controller.signal, this.operation.signal, ...(external ? [external] : [])]);
    return this.track(this.deliveries.run(async signal => {
      signal.throwIfAborted();
      if (generation !== this.generation || this.stopping) throw new Error("Telegram operation is no longer current.");
      try { return await work(signal); }
      catch (error) {
        if (error instanceof TransportQueueError) throw error;
        throw new Error("Telegram delivery could not be confirmed. Delivery may have occurred; check the chat before retrying. No automatic replay was made.");
      }
    }, signal)).catch(error => {
      if (error instanceof TransportQueueError) throw error;
      throw new Error("Telegram delivery could not be confirmed. Delivery may have occurred; check the chat before retrying. No automatic replay was made.");
    });
  }
  private remember(id: number, buttons: boolean): string {
    // A bounded connection-local capability catalogue, never arbitrary message IDs.
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error("Telegram did not return a valid message identity.");
    if (this.messages.size >= 1000) this.messages.delete(this.messages.keys().next().value!);
    const ref = randomBytes(18).toString("base64url"); this.messages.set(ref, { id, buttons }); return ref;
  }
  private async persist(text: string, signal: AbortSignal): Promise<{ messageRef: string }> {
    const sent = await this.call<TelegramMessage>("sendRichMessage", { chat_id: this.ownerUserId, rich_message: { markdown: text } }, signal);
    signal.throwIfAborted(); return { messageRef: this.remember(sent.message_id, false) };
  }
  async post(message: string, buttons?: Choices, external?: AbortSignal): Promise<{ messageRef: string }> {
    validateRichMarkdown(message); if (buttons) validateQuestion(message, buttons);
    const questionGeneration = this.questionGeneration;
    return this.deliver(signal => buttons ? this.postQuestion(message, buttons, signal, questionGeneration) : this.persist(message, signal), external);
  }
  async postEmbedded(content: EmbeddedContent, external?: AbortSignal): Promise<{ messageRef: string }> {
    const prepared = validateEmbeddedContent(content);
    const questionGeneration = this.questionGeneration;
    return this.deliver(signal => this.postQuestion(prepared.text, prepared.options, signal, questionGeneration, prepared), external);
  }
  async edit(messageRef: string, message: string, external?: AbortSignal): Promise<{ messageRef: string }> {
    validateRichMarkdown(message);
    const target = this.messages.get(messageRef);
    if (!target || target.buttons) throw new Error("Unknown, expired, or button-bearing message reference; only this connection's plain posts and finalized drafts can be edited.");
    return this.deliver(async signal => {
      if (this.messages.get(messageRef) !== target) throw new Error("Message reference expired.");
      await this.call("editMessageText", { chat_id: this.ownerUserId, message_id: target.id, rich_message: { markdown: message } }, signal);
      signal.throwIfAborted(); return { messageRef };
    }, external);
  }
  private async writeDraft(draft: Draft, signal: AbortSignal): Promise<void> {
    const suffix = "\n\n[Preview truncated]", budget = 4093;
    const text = draft.text.length <= budget ? draft.text : draft.text.slice(0, budget - suffix.length).replace(/[\uD800-\uDBFF]$/, "") + suffix;
    await this.call("sendMessageDraft", { chat_id: this.ownerUserId, draft_id: draft.id, text: text + "\u200b".repeat((draft.tick++ % 3) + 1) }, signal);
  }
  private async createAnswerDraft(text: string, signal: AbortSignal, replacedId?: number): Promise<Draft> {
    let id = randomInt(1, 2_147_483_647);
    if (id === replacedId) id = id === 2_147_483_646 ? 1 : id + 1;
    const draft = { ref: randomBytes(18).toString("base64url"), id, text, tick: 0, pending: false } as Draft;
    await this.writeDraft(draft, signal); signal.throwIfAborted();
    this.outboundDraft = draft;
    draft.heartbeat = setInterval(() => {
      if (draft.pending || this.outboundDraft !== draft) return;
      draft.pending = true;
      void this.deliver(async signal => {
        if (this.outboundDraft === draft) await this.writeDraft(draft, AbortSignal.any([signal, AbortSignal.timeout(5_000)]));
      }).catch(() => this.reportDraftError()).finally(() => { draft.pending = false; });
    }, 5_000);
    draft.heartbeat.unref?.(); this.armDraft(draft); return draft;
  }
  private retireDraft(): Draft | undefined {
    const draft = this.outboundDraft; this.outboundDraft = undefined;
    if (draft) { clearInterval(draft.heartbeat); clearTimeout(draft.expiry); }
    return draft;
  }
  private armDraft(draft: Draft): void {
    clearTimeout(draft.expiry);
    draft.expiry = setTimeout(() => { if (this.outboundDraft === draft) this.retireDraft(); }, 15 * 60_000);
    draft.expiry.unref?.();
  }
  async draft(action: "start" | "update" | "finalize" | "discard", options: { draftRef?: string; message?: string }, external?: AbortSignal): Promise<{ draftRef?: string; messageRef?: string }> {
    if (!["start", "update", "finalize", "discard"].includes(action)) throw new Error("Unknown draft action.");
    if (options.message !== undefined) validateRichMarkdown(options.message);
    if ((action === "start" || action === "update") && options.message === undefined) throw new Error("Draft start/update requires a full message snapshot.");
    if (action === "start" && options.draftRef !== undefined) throw new Error("Draft start must not supply a reference.");
    if (action !== "start" && !options.draftRef) throw new Error("Draft action requires its draftRef.");
    if (action === "discard" && options.message !== undefined) throw new Error("Draft discard does not accept a message.");
    this.assertPreviewCertain();
    if (action === "start" && this.thinkingActive()) throw new Error("Thinking is active or settling; use its explicit handoff to start an answer draft.");
    if (action === "start") { this.cancelThinking(); this.answerDraftStarts++; }
    return this.deliver(async signal => {
      const previous = this.outboundDraft;
      if (action === "start") {
        if (previous) throw new TransportQueueError("A draft is already active; finalize or discard it first. Nothing was sent.");
        const draft = await this.createAnswerDraft(options.message!, signal); return { draftRef: draft.ref };
      }
      if (!previous || previous.ref !== options.draftRef) throw new TransportQueueError("Unknown or expired draft reference; nothing was sent.");
      if (action === "discard") { this.retireDraft(); return {}; }
      if (action === "finalize") {
        this.retireDraft(); // Retire before persistence: uncertain delivery is never replayed.
        return this.persist(options.message ?? previous.text, signal);
      }
      const text = options.message!;
      await this.writeDraft({ ...previous, text }, signal); signal.throwIfAborted();
      if (this.outboundDraft !== previous) throw new Error("Draft was discarded while updating.");
      previous.text = text; previous.tick++; this.armDraft(previous); return { draftRef: previous.ref };
    }, external).finally(() => { if (action === "start") this.answerDraftStarts--; });
  }
  private retireWorking(): Working | undefined {
    const status = this.workingStatus; this.workingStatus = undefined;
    if (status) { clearInterval(status.heartbeat); clearTimeout(status.expiry); }
    return status;
  }
  private async deleteStatus(id: number, signal: AbortSignal): Promise<void> {
    try {
      await this.call("deleteMessage", { chat_id: this.ownerUserId, message_id: id }, AbortSignal.any([signal, AbortSignal.timeout(2_000)]));
    } catch (error) {
      // Only deletion of a captured status ID is idempotent. A lost successful
      // response can make its explicit retry return this exact Telegram error.
      if (!(error instanceof TelegramApiError) || error.errorCode !== 400 ||
          error.message !== "Telegram API deleteMessage failed: Bad Request: message to delete not found") throw error;
    }
    signal.throwIfAborted();
  }
  private cleanupMessage(id: number): void {
    this.statusCleanup.add(id);
    void this.effect(async signal => {
      await this.deleteStatus(id, signal);
      this.statusCleanup.delete(id);
    });
  }
  private async cleanupOnClose(method: string, body: Record<string, unknown>): Promise<void> {
    // Immutable old IDs only. No shared state or admission, and no aborted
    // connection signal: disconnect gets one bounded best-effort cleanup attempt.
    const signal = AbortSignal.timeout(2_000);
    try {
      const response = await abortable(fetch(`https://api.telegram.org/bot${this.token}/${method}`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal,
      }), signal);
      await abortable(this.readResponse(method, response), signal);
    } catch { /* Remote UI may remain inert; never delay cancellation or replay. */ }
  }
  async activity(action: "working" | "clear", external?: AbortSignal): Promise<void> {
    if (action !== "working" && action !== "clear") throw new Error("Activity must be working or clear.");
    return this.deliver(async signal => {
      if (action === "clear") {
        const old = this.retireWorking();
        if (old) this.statusCleanup.add(old.id);
        let failed = false;
        for (const id of [...this.statusCleanup]) {
          signal.throwIfAborted();
          try {
            await this.deleteStatus(id, signal);
            this.statusCleanup.delete(id);
          } catch { failed = true; } // An old failed ID must not block cleanup of newer IDs.
        }
        if (failed) throw new Error("Some Telegram status cleanup could not be confirmed.");
        return;
      }
      if (this.statusCleanup.size >= 32) throw new TransportQueueError("Too many unconfirmed status cleanups; clear activity before showing another status.");
      if (this.workingStatus) { this.armWorking(this.workingStatus); return; }
      const sent = await this.call<TelegramMessage>("sendMessage", { chat_id: this.ownerUserId, text: "Working…", disable_notification: true }, signal);
      if (signal.aborted || this.stopping) { this.cleanupMessage(sent.message_id); signal.throwIfAborted(); throw new Error("Cancelled."); }
      const status = { id: sent.message_id, tick: 0, pending: false } as Working;
      this.workingStatus = status;
      status.heartbeat = setInterval(() => {
        if (status.pending || this.workingStatus !== status) return;
        status.pending = true;
        void this.effect(async signal => {
          if (this.workingStatus === status) await this.call("editMessageText", { chat_id: this.ownerUserId, message_id: status.id, text: `Working${".".repeat((++status.tick % 3) + 1)}` }, signal);
        }).finally(() => { status.pending = false; });
      }, 5_000);
      status.heartbeat.unref?.(); this.armWorking(status);
    }, external);
  }
  private armWorking(status: Working): void {
    clearTimeout(status.expiry);
    status.expiry = setTimeout(() => {
      if (this.workingStatus === status) { this.retireWorking(); this.cleanupMessage(status.id); }
    }, 15 * 60_000);
    status.expiry.unref?.();
  }

  private async postQuestion(text: string, options: Choices, signal: AbortSignal, admittedGeneration: number, embedded?: PreparedEmbeddedContent): Promise<{ messageRef: string }> {
    if (admittedGeneration !== this.questionGeneration) throw new TransportQueueError("Question superseded before delivery; it was not sent.");
    this.expireQuestion(false);
    const generation = this.questionGeneration, nonce = randomBytes(12).toString("hex"), choices = options.map(o => ({ ...o }));
    const message = await this.call<TelegramMessage>("sendRichMessage", {
      chat_id: this.ownerUserId, rich_message: embedded ? embedded.active(nonce) : { markdown: text },
      ...(embedded ? {} : { reply_markup: { inline_keyboard: choices.map((o, i) => [{ text: o.label, callback_data: `ask:${nonce}:${i}` }]) } }),
    }, signal);
    if (generation !== this.questionGeneration || this.stopping || signal.aborted) {
      this.cleanupQuestion(message.message_id, embedded?.disabled); throw new Error("Question superseded or cancelled while sending.");
    }
    const messageRef = this.remember(message.message_id, true);
    const timer = setTimeout(() => { if (this.question?.nonce === nonce) this.expireQuestion(); }, 15 * 60_000); timer.unref?.();
    this.question = { nonce, messageId: message.message_id, text, options: choices, expires: Date.now() + 15 * 60_000, timer, disabledRichMessage: embedded?.disabled };
    return { messageRef };
  }
  private cleanupKeyboard(messageId: number): void {
    this.effect(signal => this.call("editMessageReplyMarkup", { chat_id: this.ownerUserId, message_id: messageId, reply_markup: { inline_keyboard: [] } }, AbortSignal.any([signal, AbortSignal.timeout(2_000)])).then(() => undefined));
  }
  private questionCleanup(messageId: number, disabledRichMessage?: EmbeddedRichMessage): { method: string; body: Record<string, unknown> } {
    return {
      method: disabledRichMessage ? "editMessageText" : "editMessageReplyMarkup",
      body: { chat_id: this.ownerUserId, message_id: messageId, ...(disabledRichMessage ? { rich_message: disabledRichMessage } : {}), reply_markup: { inline_keyboard: [] } },
    };
  }
  private cleanupQuestion(messageId: number, disabledRichMessage?: EmbeddedRichMessage): void {
    const captured = this.questionCleanup(messageId, disabledRichMessage);
    this.effect(signal => this.call(captured.method, captured.body, AbortSignal.any([signal, AbortSignal.timeout(2_000)])).then(() => undefined));
  }
  private expireQuestion(invalidatePending = true): void {
    if (invalidatePending) this.questionGeneration++;
    const old = this.question; this.question = undefined;
    if (old) { clearTimeout(old.timer); this.cleanupQuestion(old.messageId, old.disabledRichMessage); }
  }
  private ack(id: string, text: string): void {
    this.effect(signal => this.call("answerCallbackQuery", { callback_query_id: id, text }, signal).then(() => undefined), true);
  }
  private validOwner(message: TelegramMessage): boolean {
    return message.chat.type === "private" && message.chat.id === this.ownerUserId && message.from?.id === this.ownerUserId && !message.from.is_bot;
  }
  private validCallback(query: NonNullable<TelegramUpdate["callback_query"]>): boolean {
    return query.from.id === this.ownerUserId && !query.from.is_bot && query.message?.chat.id === this.ownerUserId && query.message.chat.type === "private";
  }
  private admit(message: TelegramInboundMessage, onMessage: Input): void {
    if (this.stopping) return;
    try {
      // Invoke synchronously. A callback's optional async continuation is supervised,
      // never awaited by polling and never automatically replayed.
      const result = onMessage(message);
      if (result) void this.track(Promise.resolve(result)).catch(() => this.sendControlNotice("Could not confirm delivery to the agent. Check the conversation before resending."));
    } catch { this.sendControlNotice("Could not confirm delivery to the agent. Check the conversation before resending."); }
  }
  private handleQuestionButton(query: NonNullable<TelegramUpdate["callback_query"]>, onMessage: Input): void {
    if (!this.validCallback(query)) return;
    const question = this.question;
    const index = question?.options.findIndex((_o, i) => query.data === `ask:${question.nonce}:${i}`) ?? -1;
    if (!question || index < 0 || question.messageId !== query.message!.message_id || Date.now() >= question.expires) {
      this.ack(query.id, "This question has expired or was already answered."); return;
    }
    if (this.incoming) { this.ack(query.id, "A file is downloading. Please choose again after it finishes."); return; }
    this.expireQuestion();
    const option = question.options[index]!;
    this.admit({ text: `Answer to Telegram question:\n${question.text}\n\nSelected: ${option.label}\n${option.reply}`, messageId: question.messageId, forceFollowUp: true }, onMessage);
    this.ack(query.id, "Selection received");
  }
  async offerUpdate(text: string, version: string, act: (approved: boolean) => void | Promise<void>): Promise<void> {
    const generation = ++this.updateGeneration, nonce = randomBytes(12).toString("hex");
    this.updateOffer = undefined;
    const message = await this.call<TelegramMessage>("sendMessage", { chat_id: this.ownerUserId, text, reply_markup: { inline_keyboard: [[{ text: `Update to v${version}`, callback_data: `update:${nonce}:yes` }, { text: "Not now", callback_data: `update:${nonce}:no` }]] } }, AbortSignal.timeout(20_000));
    if (this.stopping || generation !== this.updateGeneration) { this.cleanupKeyboard(message.message_id); return; }
    this.updateOffer = { nonce, messageId: message.message_id, act };
  }
  private handleUpdateButton(query: NonNullable<TelegramUpdate["callback_query"]>): void {
    if (!this.validCallback(query)) return;
    const offer = this.updateOffer, approved = query.data === `update:${offer?.nonce}:yes`;
    if (!offer || query.message!.message_id !== offer.messageId || (!approved && query.data !== `update:${offer.nonce}:no`)) { this.ack(query.id, "This update offer has expired."); return; }
    this.updateOffer = undefined;
    try {
      const result = offer.act(approved);
      if (result) void this.track(Promise.resolve(result)).catch(() => this.reportDraftError());
    } catch { this.reportDraftError(); }
    this.ack(query.id, approved ? "Update approved" : "Update postponed"); this.cleanupKeyboard(offer.messageId);
  }

  async start(onMessage: Input, onStopRequested: () => void, onStatusRequested: () => string | Promise<string>, onReloadRequested: () => boolean | Promise<boolean>): Promise<void> {
    const allowed = ["message", "callback_query"];
    const webhook = await this.call<{ url: string }>("getWebhookInfo", {}, AbortSignal.timeout(20_000));
    if (webhook.url) throw new Error("A Telegram webhook is configured. Run /telegram-start to confirm takeover.");
    const initial = await this.call<TelegramUpdate[]>("getUpdates", { offset: -1, limit: 1, timeout: 0, allowed_updates: allowed }, AbortSignal.timeout(20_000));
    const latest = initial.at(-1)?.update_id; if (latest !== undefined) this.offset = latest + 1;
    this.polling = this.poll(onMessage, onStopRequested, onStatusRequested, onReloadRequested, allowed);
  }
  async configureCommandMenu(): Promise<void> {
    if (this.menuPending) return this.menuPending;
    const task = (async () => {
      const commands = [ { command: "help", description: "Show Pi Telegram controls" }, { command: "status", description: "Show the connected Pi session" }, { command: "steer", description: "Steer active work: /steer message" }, { command: "stop", description: "Cancel the current Telegram task" }, { command: "reload", description: "Reload Pi resources when idle" } ];
      try { await this.call("setMyCommands", { commands, scope: { type: "chat", chat_id: this.ownerUserId } }, AbortSignal.timeout(20_000)); }
      catch (error) {
        if (!(error instanceof TelegramApiError) || error.errorCode !== 400 || !/chat not found/i.test(error.message)) throw error;
        await this.call("setMyCommands", { commands }, AbortSignal.timeout(20_000));
      }
      await this.call("setChatMenuButton", { chat_id: this.ownerUserId, menu_button: { type: "commands" } }, AbortSignal.timeout(20_000));
    })();
    this.menuPending = this.track(task);
    try { await task; } finally { if (this.menuPending === task) this.menuPending = undefined; }
  }
  private cancelOperations(): void {
    this.cancelChatAction(); this.cancelThinking();
    this.generation++; this.operation.abort(); this.operation = new AbortController();
    this.retireDraft(); const status = this.retireWorking(); this.expireQuestion();
    if (status) this.cleanupMessage(status.id);
  }
  stop(): Promise<void> {
    if (this.closing) return this.closing;
    // Revoke authority and abort polling BEFORE any network cleanup/drain.
    this.stopping = true; this.cancelChatAction(); this.cancelThinking(); this.generation++; this.operation.abort(); this.controller.abort();
    this.incoming?.controller.abort(); this.retireDraft();
    const status = this.retireWorking(); if (status) this.statusCleanup.add(status.id);
    const questionCleanup = this.question && this.questionCleanup(this.question.messageId, this.question.disabledRichMessage);
    const keyboardIds = [this.updateOffer?.messageId].filter((id): id is number => id !== undefined);
    this.expireQuestion(); this.updateGeneration++; this.updateOffer = undefined; this.messages.clear();
    const cleanup = Promise.all([
      ...[...this.statusCleanup].map(id => this.cleanupOnClose("deleteMessage", { chat_id: this.ownerUserId, message_id: id })),
      ...(questionCleanup ? [this.cleanupOnClose(questionCleanup.method, questionCleanup.body)] : []),
      ...keyboardIds.map(id => this.cleanupOnClose("editMessageReplyMarkup", { chat_id: this.ownerUserId, message_id: id, reply_markup: { inline_keyboard: [] } })),
    ]);
    this.closing = (async () => {
      // Poll completion, not an arbitrary timer, owns runtime-lease release.
      await this.polling?.catch(() => undefined);
      this.polling = undefined;
      const drain = Promise.allSettled([...this.tasks]);
      await abortable(drain, AbortSignal.timeout(2_000)).catch(() => undefined);
      await cleanup;
      this.statusCleanup.clear();
    })();
    return this.closing;
  }
  async sendPlainMessage(text: string, external?: AbortSignal): Promise<void> {
    for (const chunk of splitTelegramText(text)) await this.call("sendMessage", { chat_id: this.ownerUserId, text: chunk }, AbortSignal.any([AbortSignal.timeout(20_000), ...(external ? [external] : [])]));
  }
  async downloadIncomingFile(fileId: string, external: AbortSignal): Promise<Response> {
    const signal = AbortSignal.any([this.controller.signal, external]); signal.throwIfAborted();
    const file = await this.call<{ file_path?: string; file_size?: number }>("getFile", { file_id: fileId }, signal);
    if (file.file_size !== undefined && file.file_size > INCOMING_FILE_LIMIT) throw new Error("Incoming files must not exceed 20 MB.");
    const path = file.file_path;
    if (!path || !/^[a-zA-Z0-9_/-]+\.[a-zA-Z0-9]+$/.test(path) || path.startsWith("/") || path.split("/").some(p => p === ".." || p === ".")) throw new Error("Telegram returned an invalid file download path.");
    try {
      const response = await fetch(`https://api.telegram.org/file/bot${this.token}/${path}`, { signal, redirect: "error" });
      if (!response.ok) throw new Error("download failed"); return response;
    } catch { throw new Error("Telegram file download failed or was cancelled."); }
  }
  async sendPhoto(file: TelegramProjectFile, caption?: string, signal?: AbortSignal): Promise<void> { await this.sendAttachment("photo", file, caption, signal); }
  async sendDocument(file: TelegramProjectFile, caption?: string, signal?: AbortSignal): Promise<void> { await this.sendAttachment("document", file, caption, signal); }
  private async sendAttachment(kind: "document" | "photo", file: TelegramProjectFile, caption?: string, external?: AbortSignal): Promise<void> {
    const signal = AbortSignal.any([this.controller.signal, this.operation.signal, ...(external ? [external] : []), AbortSignal.timeout(120_000)]);
    signal.throwIfAborted(); const normalizedCaption = validateDocumentCaption(caption);
    const bytes = await readTelegramProjectFile(file); signal.throwIfAborted();
    const contentType = kind === "photo" ? await validateTelegramPhoto(bytes) : file.contentType;
    signal.throwIfAborted();
    if (bytes.byteLength > TELEGRAM_DOCUMENT_LIMIT) throw new Error("Telegram documents must not exceed 50 MB.");
    const form = new FormData(); form.set("chat_id", String(this.ownerUserId));
    form.set(kind, new Blob([new Uint8Array(bytes)], { type: contentType }), file.fileName);
    if (normalizedCaption) form.set("caption", normalizedCaption);
    const method = kind === "photo" ? "sendPhoto" : "sendDocument";
    try {
      const response = await abortable(fetch(`https://api.telegram.org/bot${this.token}/${method}`, { method: "POST", body: form, signal }), signal);
      await abortable(this.readResponse<TelegramMessage>(method, response), signal); signal.throwIfAborted();
    } catch { throw new Error(`Telegram ${kind} upload cancelled or timed out, or delivery failed. Delivery is unconfirmed; check the chat before retrying.`); }
  }

  private dispatch(update: TelegramUpdate, onMessage: Input, onStop: () => void, onStatus: () => string | Promise<string>, onReload: () => boolean | Promise<boolean>): void {
    if (update.callback_query) {
      if (update.callback_query.data?.startsWith("ask:")) this.handleQuestionButton(update.callback_query, onMessage);
      else this.handleUpdateButton(update.callback_query);
      return;
    }
    const message = update.message; if (!message || !this.validOwner(message)) return;
    const document = message.document, photo = message.photo?.slice().sort((a, b) => a.width * a.height - b.width * b.height).at(-1);
    if (document || photo) {
      if (this.incoming) { this.sendControlNotice("A file is still downloading. Please resend this attachment after it finishes."); return; }
      const attachment: IncomingAttachment = document ? { fileId: document.file_id, fileName: document.file_name || "document.bin", size: document.file_size, kind: "document" } : { fileId: photo!.file_id, fileName: "photo.jpg", size: photo!.file_size, kind: "photo" };
      const controller = new AbortController(), reception = { controller, task: Promise.resolve() }; this.incoming = reception;
      reception.task = this.track(Promise.resolve().then(() => {
        const signal = AbortSignal.any([controller.signal, this.controller.signal, AbortSignal.timeout(120_000)]);
        signal.throwIfAborted();
        return onMessage({ text: message.caption || "", messageId: message.message_id, attachment, downloadSignal: signal });
      }).catch(() => { if (!this.stopping) this.sendControlNotice("File reception failed or was cancelled. Please resend the attachment."); }).finally(() => { if (this.incoming === reception) this.incoming = undefined; }));
      return;
    }
    if (!message.text) { this.sendControlNotice("Send a document or photo to attach a file. Other incoming media types are not supported yet."); return; }
    const text = message.text.trim(), command = parseTelegramBotCommand(text);
    if (command?.name === "start" || command?.name === "help") {
      void this.configureCommandMenu().catch(() => this.reportDraftError()); this.sendControlNotice(TELEGRAM_HELP); return;
    }
    if (command?.name === "status") {
      if (!this.statusPending) {
        this.statusPending = true;
        void this.effect(async signal => { const text = await abortable(Promise.resolve(onStatus()), signal); signal.throwIfAborted(); await this.sendPlainMessage(text, signal); }).finally(() => { this.statusPending = false; });
      }
      return;
    }
    if (command?.name === "reload") {
      const result = onReload();
      const notify = (ok: boolean) => { if (!ok) this.sendControlNotice("Reload is unavailable while Pi is busy. Try /reload again after the current task finishes."); };
      if (typeof result === "boolean") notify(result); else void this.track(result.then(notify)).catch(() => this.reportDraftError());
      return;
    }
    if (command?.name === "stop" || text.toLowerCase() === "stop") {
      const incoming = this.incoming, eligible = this.options.canStop?.() ?? false;
      // Invoke the current eligible abort before resetting origins or asynchronous effects.
      incoming?.controller.abort();
      try { if (eligible) onStop(); }
      finally { this.cancelOperations(); }
      if (incoming) this.sendControlNotice("File download cancellation requested.");
      if (!incoming && !eligible) this.sendControlNotice("Nothing is currently running.");
      return;
    }
    if (command?.name === "steer") {
      if (!command.argument) { this.sendControlNotice("Usage: /steer <message>"); return; }
      this.expireQuestion(); this.admit({ text: command.argument, messageId: message.message_id, forceSteer: true }, onMessage); return;
    }
    // Ordinary input is independent of file reception; the completed file is a follow-up.
    this.expireQuestion(); this.admit({ text: message.text, messageId: message.message_id }, onMessage);
  }
  private async poll(onMessage: Input, onStop: () => void, onStatus: () => string | Promise<string>, onReload: () => boolean | Promise<boolean>, allowed: string[]): Promise<void> {
    while (!this.controller.signal.aborted) {
      try {
        const updates = await this.call<TelegramUpdate[]>("getUpdates", { ...(this.offset !== undefined ? { offset: this.offset } : {}), limit: 10, timeout: 30, allowed_updates: allowed }, AbortSignal.timeout(40_000));
        for (const update of updates) {
          if (this.stopping) return; this.offset = update.update_id + 1;
          try { this.dispatch(update, onMessage, onStop, onStatus, onReload); } catch { this.reportDraftError(); }
        }
      } catch (error) {
        if (this.controller.signal.aborted) return;
        if (error instanceof TelegramApiError && (error.errorCode === 409 || error.message.includes("Conflict"))) throw new Error("Another Pi session is already polling this Telegram bot.", { cause: error });
        await sleep(3_000, this.controller.signal);
      }
    }
  }
  private async call<T>(method: string, body: Record<string, unknown>, external: AbortSignal): Promise<T> {
    const signal = AbortSignal.any([external, this.controller.signal, ...(method === "getUpdates" ? [] : [AbortSignal.timeout(20_000)])]); signal.throwIfAborted();
    // Do not race getUpdates against a timer: lease release requires its actual
    // completion. Native fetch cooperatively aborts headers and response bodies.
    try {
      const request = fetch(`https://api.telegram.org/bot${this.token}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal });
      const response = method === "getUpdates" ? await request : await abortable(request, signal);
      const result = method === "getUpdates" ? await this.readResponse<T>(method, response) : await abortable(this.readResponse<T>(method, response), signal);
      signal.throwIfAborted(); return result;
    } catch (error) {
      if (error instanceof TelegramApiError) throw error;
      throw new Error(`Telegram transport ${method} failed.`);
    }
  }
  private async readResponse<T>(method: string, response: Response): Promise<T> {
    let envelope: TelegramApiEnvelope<T> | undefined;
    try { envelope = await response.json() as TelegramApiEnvelope<T>; } catch { /* Never expose token-bearing transport URLs. */ }
    if (!response.ok || !envelope?.ok || envelope.result === undefined) throw new TelegramApiError(method, envelope?.description || `HTTP ${response.status}`, envelope?.error_code);
    return envelope.result;
  }
}
