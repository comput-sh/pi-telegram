import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export function getTelegramPiConfigFilePath(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return resolve(
    env.TELEGRAMPI_CONFIG?.trim() ||
      join(homedir(), ".pi", "agent", "telegrampi.json"),
  );
}

export interface TelegramPiConfig {
  provisionerUrl: string;
  apiKey: string;
  botUsernamePrefix?: string;
}

interface ConfigFile {
  provisionerUrl?: unknown;
  apiKey?: unknown;
  botUsernamePrefix?: unknown;
}

function normalizeUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function normalizePrefix(value: unknown): string {
  const prefix =
    typeof value === "string" && value.trim() ? value.trim() : "pi";
  if (!/^[A-Za-z][A-Za-z0-9]{0,11}$/.test(prefix)) {
    throw new Error(
      "botUsernamePrefix must start with a letter and contain at most 12 letters or digits.",
    );
  }
  return prefix;
}

export async function loadTelegramPiConfig(
  env: NodeJS.ProcessEnv = process.env,
): Promise<TelegramPiConfig | undefined> {
  const envKey = env.TELEGRAMPI_API_KEY?.trim();
  const envUrl = env.TELEGRAMPI_PROVISIONER_URL?.trim();
  if (envKey || envUrl) {
    if (!envKey || !envUrl) {
      throw new Error(
        "TELEGRAMPI_API_KEY and TELEGRAMPI_PROVISIONER_URL must be set together.",
      );
    }
    return {
      provisionerUrl: normalizeUrl(envUrl),
      apiKey: envKey,
      botUsernamePrefix: normalizePrefix(env.TELEGRAMPI_BOT_USERNAME_PREFIX),
    };
  }

  const path = getTelegramPiConfigFilePath(env);
  let parsed: ConfigFile;
  try {
    parsed = JSON.parse(await readFile(path, "utf8")) as ConfigFile;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new Error(`Unable to read TelegramPi configuration at ${path}.`, {
      cause: error,
    });
  }

  if (
    typeof parsed.provisionerUrl !== "string" ||
    !parsed.provisionerUrl.trim()
  ) {
    throw new Error(
      `TelegramPi configuration at ${path} is missing provisionerUrl.`,
    );
  }
  if (typeof parsed.apiKey !== "string" || !parsed.apiKey.trim()) {
    throw new Error(`TelegramPi configuration at ${path} is missing apiKey.`);
  }
  return {
    provisionerUrl: normalizeUrl(parsed.provisionerUrl),
    apiKey: parsed.apiKey.trim(),
    botUsernamePrefix: normalizePrefix(parsed.botUsernamePrefix),
  };
}
