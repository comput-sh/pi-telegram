import type { TelegramPiConfig } from "./config.ts";

export interface ProjectBot {
  projectKey: string;
  projectName: string;
  botUsername: string;
  status: "pending" | "ready";
  ownerUserId?: string;
  token?: string;
  conversationUrl?: string;
  creationUrl?: string;
  provisioningId?: string;
}

function validateProjectBot(value: unknown): ProjectBot {
  const bot = value as ProjectBot;
  if (
    !bot ||
    typeof bot.projectKey !== "string" ||
    typeof bot.projectName !== "string" ||
    typeof bot.botUsername !== "string" ||
    (bot.status !== "pending" && bot.status !== "ready")
  ) {
    throw new Error("Bot provisioner returned an invalid response.");
  }
  return bot;
}

async function provisionerError(
  operation: string,
  response: Response,
): Promise<Error> {
  let detail: string | undefined;
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === "string" && body.error.trim()) {
      detail = body.error.trim();
    }
  } catch {
    // Ignore non-JSON error responses.
  }
  return new Error(
    `${operation} failed with HTTP ${response.status}${detail ? `: ${detail}` : "."}`,
  );
}

export async function getOrProvisionProjectBot(
  config: TelegramPiConfig,
  projectName: string,
  botUsername?: string,
  signal?: AbortSignal,
): Promise<ProjectBot> {
  const response = await fetch(`${config.provisionerUrl}/bots`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-functions-key": config.apiKey,
    },
    body: JSON.stringify({
      projectName,
      ...(botUsername ? { botUsername } : {}),
    }),
    signal,
  });

  if (!response.ok) {
    throw await provisionerError("Bot provisioning", response);
  }
  return validateProjectBot(await response.json());
}

export async function lookupProjectBot(
  config: TelegramPiConfig,
  projectName: string,
  signal?: AbortSignal,
): Promise<ProjectBot | undefined> {
  const response = await fetch(`${config.provisionerUrl}/bots/lookup`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-functions-key": config.apiKey,
    },
    body: JSON.stringify({ projectName }),
    signal,
  });

  if (response.status === 404) return undefined;
  if (!response.ok) {
    throw await provisionerError("Bot lookup", response);
  }

  return validateProjectBot(await response.json());
}

export async function lookupProjectBotByKey(
  config: TelegramPiConfig,
  projectKey: string,
  signal?: AbortSignal,
): Promise<ProjectBot | undefined> {
  const response = await fetch(
    `${config.provisionerUrl}/bots/${encodeURIComponent(projectKey)}`,
    {
      headers: { "x-functions-key": config.apiKey },
      signal,
    },
  );

  if (response.status === 404) return undefined;
  if (!response.ok) {
    throw await provisionerError("Bot binding lookup", response);
  }
  return validateProjectBot(await response.json());
}
