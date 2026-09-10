import { execFile } from "node:child_process";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const GLOBAL_SETTINGS_VERSION = 1;
export const PROJECT_SETTINGS_VERSION = 1;
export const PROJECT_SETTINGS_RELATIVE_PATH = join(
  ".pi",
  "pi-telegram.local.json",
);

export interface TelegramBotIdentity {
  id: string;
  username: string;
}

export interface PendingManagedBot {
  username: string;
  displayName: string;
  requestedAt: string;
}

export interface ManagerBotSettings extends TelegramBotIdentity {
  token: string;
  updateOffset?: number;
  pending?: PendingManagedBot;
}

export type GlobalSettings =
  | {
      version: 1;
      provisioningMode: "manual";
    }
  | {
      version: 1;
      provisioningMode: "manager";
      manager: ManagerBotSettings;
    };

export interface ProjectBotSettings extends TelegramBotIdentity {
  version: 1;
  token: string;
  ownerUserId: string;
  managed: boolean;
}

interface GlobalSettingsFile {
  version?: unknown;
  provisioningMode?: unknown;
  manager?: unknown;
}

interface ProjectSettingsFile {
  version?: unknown;
  bot?: unknown;
}

interface ProjectBotFile {
  id?: unknown;
  username?: unknown;
  token?: unknown;
  ownerUserId?: unknown;
  managed?: unknown;
}

export function getGlobalSettingsPath(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return resolve(
    env.PI_TELEGRAM_SETTINGS?.trim() ||
      join(homedir(), ".pi", "agent", "pi-telegram", "settings.json"),
  );
}

export function getManagerLockPath(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return join(dirname(getGlobalSettingsPath(env)), "manager.lock");
}

export function getProjectSettingsPath(cwd: string): string {
  return resolve(cwd, PROJECT_SETTINGS_RELATIVE_PATH);
}

export function normalizeBotUsername(value: string): string {
  const username = value.trim().replace(/^@/, "");
  if (
    !/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(username) ||
    !/bot$/i.test(username)
  ) {
    throw new Error(
      "Telegram bot username must be 5 to 32 letters, digits, or underscores, start with a letter, and end with Bot.",
    );
  }
  return username;
}

function normalizeTelegramId(value: unknown, label: string): string {
  const id = typeof value === "number" ? String(value) : String(value ?? "").trim();
  if (!/^\d+$/.test(id)) throw new Error(`${label} must be a Telegram numeric ID.`);
  return id;
}

function normalizeToken(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 4096) {
    throw new Error(`${label} is missing or invalid.`);
  }
  return value.trim();
}

function validateManager(value: unknown): ManagerBotSettings {
  const manager = value as Partial<ManagerBotSettings> | undefined;
  if (!manager || typeof manager.username !== "string") {
    throw new Error("Manager bot settings are missing or invalid.");
  }
  const offset = manager.updateOffset;
  if (
    offset !== undefined &&
    (!Number.isSafeInteger(offset) || Number(offset) < 0)
  ) {
    throw new Error("Manager bot updateOffset is invalid.");
  }
  const pending = manager.pending as Partial<PendingManagedBot> | undefined;
  if (
    pending !== undefined &&
    (typeof pending.username !== "string" ||
      typeof pending.displayName !== "string" ||
      !pending.displayName.trim() ||
      pending.displayName.trim().length > 64 ||
      typeof pending.requestedAt !== "string" ||
      !Number.isFinite(Date.parse(pending.requestedAt)))
  ) {
    throw new Error("Pending managed-bot settings are invalid.");
  }
  return {
    id: normalizeTelegramId(manager.id, "Manager bot ID"),
    username: normalizeBotUsername(manager.username),
    token: normalizeToken(manager.token, "Manager bot token"),
    ...(offset === undefined ? {} : { updateOffset: Number(offset) }),
    ...(pending === undefined
      ? {}
      : {
          pending: {
            username: normalizeBotUsername(pending.username!),
            displayName: pending.displayName!.trim(),
            requestedAt: new Date(pending.requestedAt!).toISOString(),
          },
        }),
  };
}

function validateGlobalSettings(
  value: unknown,
  path: string,
): GlobalSettings {
  const settings = value as GlobalSettingsFile | undefined;
  if (!settings || settings.version !== GLOBAL_SETTINGS_VERSION) {
    throw new Error(`Pi Telegram settings at ${path} are invalid.`);
  }
  if (settings.provisioningMode === "manual") {
    return { version: 1, provisioningMode: "manual" };
  }
  if (settings.provisioningMode === "manager") {
    return {
      version: 1,
      provisioningMode: "manager",
      manager: validateManager(settings.manager),
    };
  }
  throw new Error(`Pi Telegram settings at ${path} are invalid.`);
}

function validateProjectSettings(
  value: unknown,
  path: string,
): ProjectBotSettings {
  const settings = value as ProjectSettingsFile | undefined;
  const bot = settings?.bot as ProjectBotFile | undefined;
  if (
    !settings ||
    settings.version !== PROJECT_SETTINGS_VERSION ||
    !bot ||
    typeof bot.username !== "string" ||
    typeof bot.managed !== "boolean"
  ) {
    throw new Error(`Project bot settings at ${path} are invalid.`);
  }
  return {
    version: 1,
    id: normalizeTelegramId(bot.id, "Project bot ID"),
    username: normalizeBotUsername(bot.username),
    token: normalizeToken(bot.token, "Project bot token"),
    ownerUserId: normalizeTelegramId(bot.ownerUserId, "Telegram owner ID"),
    managed: bot.managed,
  };
}

async function readJson(path: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    if (error instanceof SyntaxError) {
      throw new Error(`Settings at ${path} are not valid JSON.`, { cause: error });
    }
    throw new Error(`Unable to read settings at ${path}.`, { cause: error });
  }
}

async function writePrivateJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    await rename(temporary, path);
    await chmod(path, 0o600).catch(() => undefined);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function withManagerLock<T>(
  operation: () => Promise<T>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<T> {
  const lockPath = getManagerLockPath(env);
  await mkdir(dirname(lockPath), { recursive: true, mode: 0o700 });
  let handle;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      handle = await open(lockPath, "wx", 0o600);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const information = await stat(lockPath).catch(() => undefined);
      if (
        attempt === 0 &&
        information &&
        Date.now() - information.mtimeMs > 120_000
      ) {
        await rm(lockPath, { force: true });
        continue;
      }
      throw new Error(
        "Another Pi session is configuring a managed Telegram bot. Try again when it finishes.",
      );
    }
  }
  if (!handle) throw new Error("Unable to acquire the Telegram manager lock.");
  try {
    await handle.writeFile(
      `${JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })}\n`,
      "utf8",
    );
    return await operation();
  } finally {
    await handle.close().catch(() => undefined);
    await rm(lockPath, { force: true }).catch(() => undefined);
  }
}

export async function loadGlobalSettings(
  env: NodeJS.ProcessEnv = process.env,
): Promise<GlobalSettings | undefined> {
  const path = getGlobalSettingsPath(env);
  const value = await readJson(path);
  return value === undefined ? undefined : validateGlobalSettings(value, path);
}

export async function saveGlobalSettings(
  settings: GlobalSettings,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const path = getGlobalSettingsPath(env);
  await writePrivateJson(path, validateGlobalSettings(settings, path));
}

export async function loadProjectSettings(
  cwd: string,
): Promise<ProjectBotSettings | undefined> {
  const path = getProjectSettingsPath(cwd);
  const value = await readJson(path);
  return value === undefined ? undefined : validateProjectSettings(value, path);
}

export async function saveProjectSettings(
  cwd: string,
  settings: ProjectBotSettings,
): Promise<void> {
  const path = getProjectSettingsPath(cwd);
  const validated = validateProjectSettings(
    {
      version: 1,
      bot: {
        id: settings.id,
        username: settings.username,
        token: settings.token,
        ownerUserId: settings.ownerUserId,
        managed: settings.managed,
      },
    },
    path,
  );
  await assertSafeProjectSettingsPath(cwd, path);
  await excludeProjectSettingsFromGit(cwd, path);
  await writePrivateJson(path, {
    version: 1,
    bot: {
      id: validated.id,
      username: validated.username,
      token: validated.token,
      ownerUserId: validated.ownerUserId,
      managed: validated.managed,
    },
  });
}

async function assertSafeProjectSettingsPath(
  cwd: string,
  path: string,
): Promise<void> {
  const privateDirectory = dirname(path);
  for (const candidate of [privateDirectory, path]) {
    try {
      if ((await lstat(candidate)).isSymbolicLink()) {
        throw new Error(
          `Refusing to store Telegram credentials through symbolic path ${candidate}.`,
        );
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
  }

  let repositoryRoot: string;
  try {
    repositoryRoot = (
      await execFileAsync("git", ["rev-parse", "--show-toplevel"], {
        cwd,
        windowsHide: true,
      })
    ).stdout.trim();
  } catch {
    return;
  }
  const repositoryRelativePath = relative(repositoryRoot, path).replace(/\\/g, "/");
  try {
    await execFileAsync(
      "git",
      ["ls-files", "--error-unmatch", "--", repositoryRelativePath],
      { cwd: repositoryRoot, windowsHide: true },
    );
  } catch (error) {
    if (Number((error as { code?: unknown }).code) === 1) return;
    throw error;
  }
  throw new Error(
    `Refusing to store Telegram credentials because ${repositoryRelativePath} is tracked by Git. Remove it from the index first.`,
  );
}

async function excludeProjectSettingsFromGit(
  cwd: string,
  path: string,
): Promise<void> {
  let repositoryRoot: string;
  let excludePath: string;
  try {
    repositoryRoot = (
      await execFileAsync("git", ["rev-parse", "--show-toplevel"], {
        cwd,
        windowsHide: true,
      })
    ).stdout.trim();
    excludePath = (
      await execFileAsync(
        "git",
        ["rev-parse", "--path-format=absolute", "--git-path", "info/exclude"],
        { cwd, windowsHide: true },
      )
    ).stdout.trim();
  } catch {
    return;
  }
  if (!excludePath) return;
  let existing = "";
  try {
    existing = await readFile(excludePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const relativePath = relative(repositoryRoot, path).replace(/\\/g, "/");
  const pattern = `/${relativePath}`;
  if (existing.split(/\r?\n/).includes(pattern)) return;
  await mkdir(dirname(excludePath), { recursive: true });
  const separator = existing && !existing.endsWith("\n") ? "\n" : "";
  await writeFile(excludePath, `${existing}${separator}${pattern}\n`, "utf8");
}
