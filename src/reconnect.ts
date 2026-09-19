import { setTimeout as delay } from "node:timers/promises";

/** One bounded attempt at a time; the session signal owns all future retries. */
export async function reconnectAssignedSession(options: {
  signal: AbortSignal;
  attempt(signal: AbortSignal): Promise<boolean>;
  onRetry(): void;
  retryDelays?: number[];
}): Promise<void> {
  const delays = options.retryDelays ?? [1_000, 3_000, 10_000, 30_000];
  let tries = 0;
  while (!options.signal.aborted) {
    try {
      if (await options.attempt(AbortSignal.any([options.signal, AbortSignal.timeout(30_000)]))) return;
    } catch {
      if (options.signal.aborted) return;
    }
    if (tries === 0) options.onRetry();
    const ms = delays[Math.min(tries++, delays.length - 1)] ?? 30_000;
    try { await delay(ms, undefined, { signal: options.signal, ref: false }); }
    catch { return; }
  }
}
