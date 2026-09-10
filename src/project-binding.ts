import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export const PROJECT_BINDING_FILENAME = ".telegrampi.json";

export interface TelegramProjectBinding {
  version: 1;
  projectKey: string;
  botUsername: string;
}

export function getProjectBindingPath(cwd: string): string {
  return resolve(cwd, PROJECT_BINDING_FILENAME);
}

export function normalizeBotUsername(value: string): string {
  const botUsername = value.trim().replace(/^@/, "");
  if (
    !/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(botUsername) ||
    !/bot$/i.test(botUsername)
  ) {
    throw new Error(
      "Telegram bot username must be 5 to 32 letters, digits, or underscores, start with a letter, and end with Bot.",
    );
  }
  return botUsername;
}

export function deriveBotUsername(
  projectNameInput: string,
  prefixInput = "pi",
): string {
  const projectName = projectNameInput.trim();
  if (!projectName) throw new Error("Project name is required.");

  const projectToken = projectName
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join("");
  if (!projectToken) {
    throw new Error("Project name must contain a letter or digit.");
  }

  const prefix = prefixInput.replace(/[^A-Za-z0-9]/g, "");
  if (!/^[A-Za-z][A-Za-z0-9]{0,11}$/.test(prefix)) {
    throw new Error(
      "Bot username prefix must start with a letter and contain at most 12 letters or digits.",
    );
  }
  const suffix = "Bot";
  const direct = `${prefix}${projectToken}${suffix}`;
  if (direct.length <= 32) return direct;

  const hash = createHash("sha256")
    .update(projectName.toLowerCase(), "utf8")
    .digest("hex")
    .slice(0, 6);
  const available = 32 - prefix.length - hash.length - suffix.length;
  return `${prefix}${projectToken.slice(0, available)}${hash}${suffix}`;
}

function validateBinding(value: unknown, path: string): TelegramProjectBinding {
  const binding = value as Partial<TelegramProjectBinding> | undefined;
  if (
    !binding ||
    binding.version !== 1 ||
    typeof binding.projectKey !== "string" ||
    !binding.projectKey.trim() ||
    binding.projectKey.length > 128 ||
    typeof binding.botUsername !== "string"
  ) {
    throw new Error(`TelegramPi project binding at ${path} is invalid.`);
  }

  return {
    version: 1,
    projectKey: binding.projectKey.trim(),
    botUsername: normalizeBotUsername(binding.botUsername),
  };
}

export async function loadProjectBinding(
  cwd: string,
): Promise<TelegramProjectBinding | undefined> {
  const path = getProjectBindingPath(cwd);
  try {
    return validateBinding(JSON.parse(await readFile(path, "utf8")), path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    if (error instanceof SyntaxError) {
      throw new Error(`TelegramPi project binding at ${path} is not valid JSON.`, {
        cause: error,
      });
    }
    throw error;
  }
}

export async function saveProjectBinding(
  cwd: string,
  bot: { projectKey: string; botUsername: string },
  options: { allowUsernameUpdate?: boolean } = {},
): Promise<TelegramProjectBinding> {
  const path = getProjectBindingPath(cwd);
  const binding: TelegramProjectBinding = {
    version: 1,
    projectKey: bot.projectKey.trim(),
    botUsername: normalizeBotUsername(bot.botUsername),
  };
  if (!binding.projectKey) throw new Error("Cannot save an empty project key.");

  const existing = await loadProjectBinding(cwd);
  if (existing) {
    if (existing.projectKey !== binding.projectKey) {
      throw new Error(
        `TelegramPi project binding at ${path} already points to project ${existing.projectKey}.`,
      );
    }
    if (existing.botUsername.toLowerCase() === binding.botUsername.toLowerCase()) {
      return existing;
    }
    if (!options.allowUsernameUpdate) {
      throw new Error(
        `TelegramPi project binding at ${path} already points to @${existing.botUsername}.`,
      );
    }
    await writeFile(path, `${JSON.stringify(binding, null, 2)}\n`, "utf8");
    return binding;
  }

  try {
    await writeFile(path, `${JSON.stringify(binding, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const raced = await loadProjectBinding(cwd);
    if (
      !raced ||
      raced.projectKey !== binding.projectKey ||
      raced.botUsername.toLowerCase() !== binding.botUsername.toLowerCase()
    ) {
      throw new Error(`TelegramPi project binding at ${path} changed concurrently.`);
    }
    return raced;
  }

  return binding;
}

export function assertBindingMatchesBot(
  binding: TelegramProjectBinding,
  bot: { projectKey: string; botUsername: string },
): void {
  if (
    binding.projectKey !== bot.projectKey ||
    binding.botUsername.toLowerCase() !== bot.botUsername.toLowerCase()
  ) {
    throw new Error(
      `TelegramPi project binding expects @${binding.botUsername}, but the provisioner returned @${bot.botUsername}.`,
    );
  }
}
