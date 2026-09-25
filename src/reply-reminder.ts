export const TELEGRAM_REPLY_REMINDER =
  "[Telegram reply reminder] Please send a brief response to the preceding Telegram request using telegram_post, or another appropriate explicit Telegram reply tool. Summarize the answer, blocker, or error honestly. Do not repeat the underlying task, re-execute actions, infer approval, or replay an uncertain delivery. Do not quote private prompts, hidden reasoning, or raw tool details. This is a one-time reminder, not a new user instruction or permission.";

export interface ReminderContext {
  isIdle(): boolean;
  hasPendingMessages?(): boolean;
}
interface Candidate<T> {
  destination: T;
  settled: boolean;
  used: boolean;
  reply: "none" | "attempted" | "confirmed";
}
type Schedule = (work: () => Promise<void>, delayMs: number) => () => void;
const schedule: Schedule = (work, delayMs) => {
  const timer = setTimeout(() => { void work(); }, delayMs);
  timer.unref?.();
  return () => clearTimeout(timer);
};

/** One latest processed inbound request, one nonrecursive reminder budget. */
export class ReplyReminder<T> {
  private current?: Candidate<T>;
  private cancelTimer?: () => void;
  constructor(private readonly options: {
    currentConnection(): T | undefined;
    verify(destination: T, context: ReminderContext): Promise<boolean>;
    remind(destination: T): void;
    schedule?: Schedule;
    graceMs?: number;
  }) {}
  invalidate(): void {
    this.cancelTimer?.(); this.cancelTimer = undefined;
    this.current = undefined;
  }
  begin(destination: T | undefined, eligible: boolean): void {
    this.invalidate();
    if (destination !== undefined && eligible && destination === this.options.currentConnection())
      this.current = { destination, settled: false, used: false, reply: "none" };
  }
  agentStarted(): boolean {
    // Normal agent_start may precede or follow the original user message_start.
    // A new run after settlement must retire the old grace window.
    if (this.current?.settled) { this.invalidate(); return true; }
    return false;
  }
  attempt(destination: T | undefined): () => void {
    const request = this.current;
    if (!request || request.settled || request.destination !== destination || destination !== this.options.currentConnection()) return () => {};
    // Conservative: even guard/validation failures suppress the reminder. A
    // transport may accept a delivery and still throw, so never invite replay.
    request.reply = "attempted";
    return () => { if (this.current === request) request.reply = "confirmed"; };
  }
  settled(context: ReminderContext): void {
    const request = this.current;
    if (!request || request.used || request.reply !== "none" || this.cancelTimer) return;
    request.settled = true;
    const eligible = () => this.current === request && request.destination === this.options.currentConnection()
      && context.isIdle() && !context.hasPendingMessages?.() && request.reply === "none";
    if (!eligible()) { this.invalidate(); return; }
    this.cancelTimer = (this.options.schedule ?? schedule)(async () => {
      this.cancelTimer = undefined;
      if (!eligible() || request.used) return;
      request.used = true; // Consume before async checks/enqueue: never retry uncertainty.
      try {
        if (!(await this.options.verify(request.destination, context)) || !eligible()) return;
        this.options.remind(request.destination);
      } catch { /* Best effort only; no automatic replay or user-response synthesis. */ }
    }, this.options.graceMs ?? 5_000);
  }
}
