import { AsyncLocalStorage } from "node:async_hooks";
import { mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import lockfile from "proper-lockfile";

// Heartbeat-based mkdir locks: never unlink a lock based on one PID/mtime snapshot.
// proper-lockfile owns stale recovery, heartbeat renewal and compromised detection.
const held = new AsyncLocalStorage<Map<string, () => void>>();

export async function assertNoLegacyOwner(path: string): Promise<void> {
  let record: { pid?: number };
  try {
    record = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw new Error(
      "An unreadable legacy Pi Telegram lock exists. Stop old Pi processes before removing it locally.",
    );
  }
  if (!Number.isSafeInteger(record.pid) || record.pid! <= 0) {
    throw new Error(
      "An invalid legacy Pi Telegram lock requires local inspection.",
    );
  }
  try {
    process.kill(record.pid!, 0);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return;
    throw new Error("Unable to verify the legacy Pi Telegram lock owner.");
  }
  throw new Error(
    "An older Pi Telegram process holds this lock. Release or reload it first.",
  );
}

export function assertLocksHealthy(): void {
  for (const check of held.getStore()?.values() ?? []) check();
}

export async function withPrivateLock<T>(
  path: string,
  conflictMessage: string,
  operation: () => Promise<T>,
  allowReentry = false,
): Promise<T> {
  const parent = held.getStore();
  if (parent?.has(path)) {
    if (!allowReentry) throw new Error(conflictMessage);
    assertLocksHealthy();
    return operation();
  }
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await assertNoLegacyOwner(path);
  let compromised: Error | undefined;
  let release: () => Promise<void>;
  try {
    release = await lockfile.lock(path, {
      realpath: false,
      lockfilePath: `${path}.guard`,
      stale: 120_000,
      update: 10_000,
      retries: 0,
      onCompromised: (error) => {
        compromised = error;
      },
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ELOCKED")
      throw new Error(conflictMessage);
    throw error;
  }
  const checks = new Map(parent);
  checks.set(path, () => {
    if (compromised)
      throw new Error(
        "Pi Telegram lost its settings lock; the operation was cancelled.",
      );
  });
  try {
    return await held.run(checks, operation);
  } finally {
    await release();
  }
}
