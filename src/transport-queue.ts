export class TransportQueueError extends Error {}

/** Abort-aware waiting, including response-body readers supplied by a transport. */
export function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    void work.catch(() => undefined); // A transport may already have started before cancellation won.
    return Promise.reject(signal.reason ?? new Error("Cancelled."));
  }
  return new Promise<T>((resolve, reject) => {
    const aborted = () => reject(signal.reason ?? new Error("Cancelled."));
    signal.addEventListener("abort", aborted, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", aborted));
  });
}

/** FIFO admission with bounded residence, depth and total lifetime. No replay. */
export class TransportQueue {
  private waiting: Array<{
    start(): void;
  }> = [];
  private running = false;
  constructor(private readonly limits = { depth: 16, residenceMs: 10_000, totalMs: 60_000 }) {}

  run<T>(work: (signal: AbortSignal) => Promise<T>, external: AbortSignal): Promise<T> {
    if (external.aborted) return Promise.reject(new TransportQueueError("Telegram operation cancelled before delivery."));
    if (this.running && this.waiting.length >= this.limits.depth)
      return Promise.reject(new TransportQueueError("Telegram delivery queue is full; this operation was not sent."));
    return new Promise<T>((resolve, reject) => {
      const controller = new AbortController();
      const signal = AbortSignal.any([external, controller.signal]);
      let started = false, settled = false;
      const cleanup = () => {
        clearTimeout(residence); clearTimeout(total);
        signal.removeEventListener("abort", onAbort);
      };
      const finish = (error?: unknown, value?: T) => {
        if (settled) return;
        settled = true; cleanup();
        if (error !== undefined) reject(error); else resolve(value!);
      };
      const onAbort = () => {
        if (!started) {
          this.waiting = this.waiting.filter(item => item !== entry);
          finish(new TransportQueueError("Telegram operation cancelled or expired before delivery; it was not sent."));
        }
      };
      const residence = setTimeout(() => {
        if (!started) controller.abort(new TransportQueueError("Telegram delivery queue wait expired; operation was not sent."));
      }, this.limits.residenceMs);
      const total = setTimeout(() => controller.abort(new Error("Telegram operation timed out.")), this.limits.totalMs);
      const entry = {
        start: () => {
          if (settled || signal.aborted) { onAbort(); this.next(); return; }
          started = true; clearTimeout(residence); this.running = true;
          void abortable(Promise.resolve().then(() => { signal.throwIfAborted(); return work(signal); }), signal)
            .then(value => finish(undefined, value), error => finish(error))
            .finally(() => this.next());
        },
      };
      signal.addEventListener("abort", onAbort, { once: true });
      if (this.running) this.waiting.push(entry); else entry.start();
    });
  }

  private next(): void {
    this.running = false;
    this.waiting.shift()?.start();
  }
}
