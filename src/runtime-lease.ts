import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import lockfile from "proper-lockfile";
import { getGlobalSettingsPath } from "./config.ts";
import { assertNoLegacyOwner } from "./locks.ts";

export interface TelegramRuntimeLease {
  readonly botId: string;
  readonly sessionId: string;
  readonly projectPath: string;
  readonly signal: AbortSignal;
  release(): Promise<void>;
}

function leasePath(botId: string, env: NodeJS.ProcessEnv): string {
  if (!/^\d+$/.test(botId)) throw new Error("Invalid Telegram bot ID.");
  return join(dirname(getGlobalSettingsPath(env)), "runtime", `${botId}.lock`);
}

export async function runtimeOwner(
  botId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ pid: number; sessionId: string } | undefined> {
  const path = leasePath(botId, env);
  if (
    !(await lockfile.check(path, {
      realpath: false,
      lockfilePath: `${path}.guard`,
      stale: 120_000,
    }))
  )
    return;
  try {
    const value = JSON.parse(await readFile(`${path}.owner.json`, "utf8"));
    if (Number.isSafeInteger(value.pid) && typeof value.sessionId === "string")
      return value;
  } catch {
    /* Acquiring process may not have written metadata yet. */
  }
  return { pid: 0, sessionId: "starting" };
}

export async function acquireTelegramRuntimeLease(
  botId: string,
  sessionId: string,
  projectPath: string,
  options: {
    waitMs?: number;
    env?: NodeJS.ProcessEnv;
    signal?: AbortSignal;
  } = {},
): Promise<TelegramRuntimeLease | undefined> {
  const path = leasePath(botId, options.env ?? process.env);
  const lockPath = `${path}.guard`;
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await assertNoLegacyOwner(path);
  const controller = new AbortController();
  const deadline = Date.now() + (options.waitMs ?? 0);
  let release: (() => Promise<void>) | undefined;
  while (!release) {
    options.signal?.throwIfAborted();
    try {
      release = await lockfile.lock(path, {
        realpath: false,
        lockfilePath: lockPath,
        stale: 120_000,
        update: 10_000,
        retries: 0,
        onCompromised: () =>
          controller.abort(new Error("Telegram runtime lease was lost.")),
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ELOCKED") throw error;
      if (Date.now() >= deadline) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  // Metadata is kept outside the lock directory so stale recovery can rmdir it.
  const metadata = `${path}.owner.json`;
  try {
    await writeFile(
      metadata,
      JSON.stringify({ pid: process.pid, sessionId, projectPath }),
      { mode: 0o600 },
    );
  } catch (error) {
    await release();
    throw error;
  }
  let released = false;
  return {
    botId,
    sessionId,
    projectPath,
    signal: controller.signal,
    async release() {
      if (released) return;
      released = true;
      if (!controller.signal.aborted) await rm(metadata, { force: true });
      await release!().catch((error) => {
        if (!controller.signal.aborted) throw error;
      });
      controller.abort();
    },
  };
}
