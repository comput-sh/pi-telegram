import { randomUUID } from "node:crypto";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { ReplyReminder, TELEGRAM_REPLY_REMINDER } from "./reply-reminder.ts";
import { wrapTelegramInput } from "./routing.ts";
import type { TelegramSessionConnection } from "./telegram.ts";

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter(part => part?.type === "text").map(part => part.text).join("\n");
}
interface Origin<T> { destination: T; admitted: boolean; reminder: boolean; isCurrent?: () => boolean }

// The public transport prefix is guidance, not authentication. Only a one-use
// receipt admitted through extension input can establish inbound provenance.
export class RequestOrigins<T> {
  private pending = new Map<string, Origin<T>>();
  current?: T;
  private retired = new Set<string>();
  private retiredReminders = new Set<string>();
  private retireReminder(text: string): void {
    this.retiredReminders.add(text);
    if (this.retiredReminders.size > 1000) this.retiredReminders.delete(this.retiredReminders.values().next().value!);
  }
  private currentText?: string;
  invalidated = false;
  reminderEligible = false;
  constructor(private readonly onEnqueue?: () => void) {}
  enqueue(text: string, destination: T, options: { reminder?: boolean; isCurrent?: () => boolean } = {}): string {
    if (this.pending.size >= 100) throw new Error("Too many pending Telegram requests.");
    const content = `${wrapTelegramInput(text)}\n\n[Pi Telegram request: ${randomUUID()}]`;
    if (!options.reminder) this.onEnqueue?.();
    this.pending.set(content, { destination, admitted: false, reminder: options.reminder ?? false, isCurrent: options.isCurrent });
    return content;
  }
  isReminder(text: string): boolean { return (this.pending.get(text)?.reminder ?? false) || this.retiredReminders.has(text); }
  discard(text: string): void { this.pending.delete(text); }
  admit(text: string, source: string): boolean {
    const origin = this.pending.get(text);
    if (source !== "extension") { this.pending.delete(text); return true; }
    if (this.retiredReminders.has(text)) return false;
    if (origin?.isCurrent && !origin.isCurrent()) { this.pending.delete(text); return false; }
    if (origin) origin.admitted = true;
    return true;
  }
  begin(content: unknown): T | undefined {
    const text = textOf(content);
    const origin = this.pending.get(text);
    this.pending.delete(text);
    const accepted = origin?.admitted && (!origin.isCurrent || origin.isCurrent());
    this.invalidated = this.retired.has(text) || (!!origin?.reminder && !accepted);
    this.reminderEligible = !!accepted && !origin!.reminder;
    this.currentText = accepted ? text : undefined;
    this.current = accepted ? origin!.destination : undefined;
    return this.current;
  }
  reset(): void {
    for (const [text, origin] of this.pending) {
      this.retired.add(text);
      if (origin.reminder) this.retireReminder(text);
    }
    if (this.currentText) {
      this.retired.add(this.currentText);
      if (!this.reminderEligible) this.retireReminder(this.currentText);
    }
    this.pending.clear(); this.current = undefined; this.currentText = undefined; this.reminderEligible = false;
  }
}

/** Inbound provenance only. No public-text mirroring, drafts or tool tracking. */
export function registerResponseRouting(pi: ExtensionAPI, currentConnection: () => TelegramSessionConnection | undefined, reminderOptions?: {
  verify(destination: TelegramSessionConnection, context: ExtensionContext): Promise<boolean>;
  schedule?: (work: () => Promise<void>, delayMs: number) => () => void;
}) {
  let generation = 0;
  let reminderStarting = false;
  let reminder: ReplyReminder<TelegramSessionConnection> | undefined;
  const invalidateReminder = () => { generation++; reminderStarting = false; reminder?.invalidate(); };
  const origins = new RequestOrigins<TelegramSessionConnection>(invalidateReminder);
  if (reminderOptions) reminder = new ReplyReminder({
    currentConnection,
    verify: (destination, context) => reminderOptions.verify(destination, context as ExtensionContext),
    schedule: reminderOptions.schedule,
    remind: destination => {
      const expected = generation;
      const content = origins.enqueue(TELEGRAM_REPLY_REMINDER, destination, { reminder: true, isCurrent: () => generation === expected && currentConnection() === destination });
      try {
        // Idle-only injection: deliberately omit deliverAs, so a host race into
        // active work rejects rather than queues/steers an unrelated console turn.
        pi.sendUserMessage(content);
      } catch { origins.discard(content); throw new Error("Reminder admission was not confirmed."); }
    },
  });
  let invalidatedRequest = false;
  const destination = () => origins.current === currentConnection() ? origins.current : undefined;
  const outboundDestination = () => {
    if (invalidatedRequest || (origins.current && origins.current !== currentConnection())) return undefined;
    return currentConnection();
  };
  const reset = () => {
    invalidateReminder();
    invalidatedRequest ||= !!origins.current;
    origins.reset();
  };
  pi.on("input", (event, ctx) => {
    const synthetic = event.source === "extension" && origins.isReminder(event.text);
    if (synthetic) {
      if (!ctx.isIdle() || !origins.admit(event.text, event.source)) {
        origins.discard(event.text); invalidateReminder(); return { action: "handled" as const };
      }
      reminderStarting = true;
    } else {
      invalidateReminder();
      origins.admit(event.text, event.source);
    }
  });
  pi.on("agent_start", () => {
    const startingReminder = reminderStarting;
    reminderStarting = false; // One lifecycle admission, never a sticky exemption.
    if (!startingReminder && reminder?.agentStarted()) generation++;
  });
  pi.on("message_start", event => {
    if (event.message.role !== "user") return;
    const synthetic = origins.isReminder(textOf(event.message.content));
    if (!synthetic) invalidateReminder();
    origins.begin(event.message.content);
    reminderStarting = false;
    invalidatedRequest = origins.invalidated;
    reminder?.begin(destination(), origins.reminderEligible);
  });
  pi.on("agent_settled", (_event, ctx) => {
    reminder?.settled(ctx);
    origins.current = undefined;
    invalidatedRequest = false;
  });
  pi.on("session_shutdown", reset);
  const replyAttempt = () => reminder?.attempt(destination()) ?? (() => {});
  return { origins, destination, outboundDestination, reset, replyAttempt };
}
