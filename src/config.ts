import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, parse, relative, resolve } from "node:path";
import { promisify } from "node:util";

import { assertLocksHealthy, withPrivateLock } from "./locks.ts";

const execFileAsync = promisify(execFile);

export const GLOBAL_SETTINGS_VERSION = 1;
export const PROJECT_SETTINGS_VERSION = 2;
export const PROJECT_SETTINGS_RELATIVE_PATH = join(
  ".pi",
  "pi-telegram.local.json",
);

export interface TelegramBotIdentity {
  id: string;
  username: string;
}

export interface KnownManagedBot extends TelegramBotIdentity {
  ownerUserId: string;
  lastSeenAt: string;
}

export interface PendingManagedBot {
  username: string;
  displayName: string;
  requestedAt: string;
  projectPath?: string;
  sessionId?: string;
}

export interface ManagerBotSettings extends TelegramBotIdentity {
  token: string;
  updateOffset?: number;
  pending?: PendingManagedBot;
  knownBots?: KnownManagedBot[];
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
  token: string;
  ownerUserId: string;
  managed: boolean;
  sessionId: string | null;
}

export interface ProjectSettings {
  version: 2;
  bots: ProjectBotSettings[];
}

interface GlobalSettingsFile {
  version?: unknown;
  provisioningMode?: unknown;
  manager?: unknown;
}

interface ProjectSettingsFile {
  version?: unknown;
  bots?: unknown;
  bot?: unknown;
}

interface ProjectBotFile {
  id?: unknown;
  username?: unknown;
  token?: unknown;
  ownerUserId?: unknown;
  managed?: unknown;
  sessionId?: unknown;
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

function getProjectMutationLockPath(
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const key = createHash("sha256")
    .update(resolve(cwd).toLowerCase(), "utf8")
    .digest("hex")
    .slice(0, 24);
  return join(
    dirname(getGlobalSettingsPath(env)),
    "project-locks",
    `${key}.lock`,
  );
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
  const id =
    typeof value === "number" ? String(value) : String(value ?? "").trim();
  if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id)))
    throw new Error(`${label} must be a positive, safe Telegram numeric ID.`);
  return id;
}

function normalizeToken(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 4096) {
    throw new Error(`${label} is missing or invalid.`);
  }
  return value.trim();
}

function normalizeSessionId(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !value.trim() || value.length > 256) {
    throw new Error("Assigned Pi session ID is invalid.");
  }
  return value.trim();
}

function normalizeDate(value: unknown, label: string): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${label} is invalid.`);
  }
  return new Date(value).toISOString();
}

function validateKnownBots(value: unknown): KnownManagedBot[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 500) {
    throw new Error("Manager knownBots is invalid.");
  }
  const ids = new Set<string>();
  const usernames = new Set<string>();
  return value.map((candidate) => {
    const bot = candidate as Partial<KnownManagedBot>;
    const id = normalizeTelegramId(bot.id, "Known bot ID");
    const username = normalizeBotUsername(String(bot.username ?? ""));
    if (ids.has(id) || usernames.has(username.toLowerCase())) {
      throw new Error("Manager knownBots contains duplicate bots.");
    }
    ids.add(id);
    usernames.add(username.toLowerCase());
    return {
      id,
      username,
      ownerUserId: normalizeTelegramId(bot.ownerUserId, "Known bot owner ID"),
      lastSeenAt: normalizeDate(bot.lastSeenAt, "Known bot lastSeenAt"),
    };
  });
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
      (pending.projectPath !== undefined && (typeof pending.projectPath !== "string" || !pending.projectPath.trim())) ||
      (pending.sessionId !== undefined && (typeof pending.sessionId !== "string" || !pending.sessionId.trim())) ||
      ((pending.projectPath === undefined) !== (pending.sessionId === undefined)))
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
            ...(pending.projectPath === undefined ? {} : { projectPath: pending.projectPath, sessionId: pending.sessionId! }),
            requestedAt: normalizeDate(
              pending.requestedAt,
              "Pending managed-bot requestedAt",
            ),
          },
        }),
    ...(manager.knownBots === undefined
      ? {}
      : { knownBots: validateKnownBots(manager.knownBots) }),
  };
}

function validateGlobalSettings(value: unknown, path: string): GlobalSettings {
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

function validateProjectBot(value: unknown): ProjectBotSettings {
  const bot = value as ProjectBotFile | undefined;
  if (
    !bot ||
    typeof bot.username !== "string" ||
    typeof bot.managed !== "boolean"
  ) {
    throw new Error("Project bot entry is invalid.");
  }
  return {
    id: normalizeTelegramId(bot.id, "Project bot ID"),
    username: normalizeBotUsername(bot.username),
    token: normalizeToken(bot.token, "Project bot token"),
    ownerUserId: normalizeTelegramId(bot.ownerUserId, "Telegram owner ID"),
    managed: bot.managed,
    sessionId: normalizeSessionId(bot.sessionId),
  };
}

function validateProjectSettings(
  value: unknown,
  path: string,
): ProjectSettings {
  const settings = value as ProjectSettingsFile | undefined;
  let candidates: unknown[];
  if (settings?.version === 1 && settings.bot) {
    const legacy = settings.bot as ProjectBotFile;
    candidates = [{ ...legacy, sessionId: null }];
  } else if (
    settings?.version === PROJECT_SETTINGS_VERSION &&
    Array.isArray(settings.bots) &&
    settings.bots.length <= 100
  ) {
    candidates = settings.bots;
  } else {
    throw new Error(`Project bot settings at ${path} are invalid.`);
  }
  const bots = candidates.map(validateProjectBot);
  const ids = new Set<string>();
  const usernames = new Set<string>();
  const sessions = new Set<string>();
  for (const bot of bots) {
    if (ids.has(bot.id) || usernames.has(bot.username.toLowerCase())) {
      throw new Error(
        `Project bot settings at ${path} contain duplicate bots.`,
      );
    }
    ids.add(bot.id);
    usernames.add(bot.username.toLowerCase());
    if (bot.sessionId) {
      if (sessions.has(bot.sessionId)) {
        throw new Error(
          `Project bot settings at ${path} assign multiple bots to one Pi session.`,
        );
      }
      sessions.add(bot.sessionId);
    }
  }
  return { version: 2, bots };
}

async function readJson(path: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    if (error instanceof SyntaxError) {
      // SyntaxError may include a snippet of credential-bearing JSON.
      throw new Error(`Settings at ${path} are not valid JSON.`);
    }
    throw new Error(`Unable to read settings at ${path}.`);
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
    assertLocksHealthy();
    await rename(temporary, path);
    await chmod(path, 0o600).catch(() => undefined);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

const withLock = withPrivateLock;

export async function withManagerLock<T>(
  operation: () => Promise<T>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<T> {
  return withLock(
    getManagerLockPath(env),
    "Another Pi session is configuring a managed Telegram bot. Try again when it finishes.",
    operation,
  );
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
  await withPrivateLock(
    getManagerLockPath(env),
    "Another Pi session is updating Telegram manager settings.",
    async () => {
      const cwd = await findExistingDirectory(dirname(path));
      await assertSafeCredentialPath(cwd, path);
      await excludeProjectSettingsFromGit(cwd, path);
      await writePrivateJson(path, validateGlobalSettings(settings, path));
    },
    true,
  );
}

export async function loadProjectSettings(
  cwd: string,
): Promise<ProjectSettings | undefined> {
  const path = getProjectSettingsPath(cwd);
  const value = await readJson(path);
  return value === undefined ? undefined : validateProjectSettings(value, path);
}

async function writeProjectSettings(
  cwd: string,
  settings: ProjectSettings,
): Promise<ProjectSettings> {
  const path = getProjectSettingsPath(cwd);
  const validated = validateProjectSettings(settings, path);
  await assertSafeCredentialPath(cwd, path);
  await excludeProjectSettingsFromGit(cwd, path);
  await writePrivateJson(path, validated);
  return validated;
}

export async function saveProjectSettings(
  cwd: string,
  settings: ProjectSettings,
): Promise<ProjectSettings> {
  return withLock(
    getProjectMutationLockPath(cwd),
    "Another Pi session is updating this project's Telegram configuration.",
    () => writeProjectSettings(cwd, settings),
  );
}

export async function updateProjectSettings(
  cwd: string,
  update: (
    settings: ProjectSettings,
  ) => ProjectSettings | Promise<ProjectSettings>,
): Promise<ProjectSettings> {
  return withLock(
    getProjectMutationLockPath(cwd),
    "Another Pi session is updating this project's Telegram configuration.",
    async () => {
      const current = (await loadProjectSettings(cwd)) ?? {
        version: 2,
        bots: [],
      };
      return writeProjectSettings(cwd, await update(current));
    },
  );
}

export function findSessionBot(
  settings: ProjectSettings,
  sessionId: string,
): ProjectBotSettings | undefined {
  return settings.bots.find((bot) => bot.sessionId === sessionId);
}

export class AssignmentChangedError extends Error {
  constructor() {
    super(
      "Telegram assignments changed while the dialog was open. Start again to review and confirm the current owner.",
    );
  }
}

export function assertProjectSnapshot(
  current: ProjectSettings,
  expected?: ProjectSettings,
): void {
  if (expected && JSON.stringify(current) !== JSON.stringify(expected))
    throw new AssignmentChangedError();
}

// Rollback is compare-and-swap too: never undo another session's later decision.
export async function restoreProjectSnapshot(
  cwd: string,
  expected: ProjectSettings,
  previous: ProjectSettings,
): Promise<void> {
  await updateProjectSettings(cwd, (current) => {
    assertProjectSnapshot(current, expected);
    return previous;
  });
}

export async function upsertAndAssignProjectBot(
  cwd: string,
  bot: Omit<ProjectBotSettings, "sessionId">,
  sessionId: string,
  expected?: ProjectSettings,
): Promise<ProjectBotSettings> {
  let assigned: ProjectBotSettings | undefined;
  await updateProjectSettings(cwd, (settings) => {
    assertProjectSnapshot(settings, expected);
    const normalizedBot = validateProjectBot({ ...bot, sessionId });
    const retained = settings.bots.filter(
      (candidate) =>
        candidate.id !== normalizedBot.id &&
        candidate.username.toLowerCase() !==
          normalizedBot.username.toLowerCase(),
    );
    const bots = retained.map((candidate) =>
      candidate.sessionId === sessionId
        ? { ...candidate, sessionId: null }
        : candidate,
    );
    assigned = normalizedBot;
    bots.push(normalizedBot);
    return { version: 2, bots };
  });
  return assigned!;
}

export async function assignProjectBot(
  cwd: string,
  botId: string,
  sessionId: string,
  expected?: ProjectSettings,
): Promise<ProjectBotSettings> {
  let assigned: ProjectBotSettings | undefined;
  await updateProjectSettings(cwd, (settings) => {
    assertProjectSnapshot(settings, expected);
    if (!settings.bots.some((bot) => bot.id === botId)) {
      throw new Error(
        `Telegram bot ${botId} is not configured in this project.`,
      );
    }
    const bots = settings.bots.map((bot) => {
      if (bot.id === botId) {
        assigned = { ...bot, sessionId };
        return assigned;
      }
      return bot.sessionId === sessionId ? { ...bot, sessionId: null } : bot;
    });
    return { version: 2, bots };
  });
  return assigned!;
}

export async function releaseProjectBot(
  cwd: string,
  botId: string,
  sessionId: string,
): Promise<boolean> {
  let released = false;
  await updateProjectSettings(cwd, (settings) => ({
    version: 2,
    bots: settings.bots.map((bot) => {
      if (bot.id !== botId || bot.sessionId !== sessionId) return bot;
      released = true;
      return { ...bot, sessionId: null };
    }),
  }));
  return released;
}

export async function removeProjectBot(
  cwd: string,
  botId: string,
  expected?: ProjectSettings,
): Promise<ProjectBotSettings | undefined> {
  let removed: ProjectBotSettings | undefined;
  await updateProjectSettings(cwd, (settings) => {
    assertProjectSnapshot(settings, expected);
    return {
      version: 2,
      bots: settings.bots.filter((bot) => {
        if (bot.id !== botId) return true;
        removed = bot;
        return false;
      }),
    };
  });
  return removed;
}

async function findExistingDirectory(path: string): Promise<string> {
  let candidate = resolve(path);
  while (true) {
    try {
      if ((await stat(candidate)).isDirectory()) return candidate;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const parent = dirname(candidate);
    if (parent === candidate) return parent;
    candidate = parent;
  }
}

async function assertNoSymbolicComponents(path: string): Promise<void> {
  const absolute = resolve(path);
  const root = parse(absolute).root;
  let candidate = root;
  for (const part of relative(root, absolute)
    .split(/[\\/]+/)
    .filter(Boolean)) {
    candidate = join(candidate, part);
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
}

async function assertSafeCredentialPath(
  cwd: string,
  path: string,
): Promise<void> {
  await assertNoSymbolicComponents(path);

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
  const repositoryRelativePath = relative(repositoryRoot, path).replace(
    /\\/g,
    "/",
  );
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
  const temporaryPattern = `${pattern}.*.tmp`;
  const additions = [pattern, temporaryPattern].filter(
    (line) => !existing.split(/\r?\n/).includes(line),
  );
  if (!additions.length) return;
  await mkdir(dirname(excludePath), { recursive: true });
  const separator = existing && !existing.endsWith("\n") ? "\n" : "";
  await writeFile(
    excludePath,
    `${existing}${separator}${additions.join("\n")}\n`,
    "utf8",
  );
}
