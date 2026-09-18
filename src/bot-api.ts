import { randomInt } from "node:crypto";

import {
  normalizeBotUsername,
  type KnownManagedBot,
  type ManagerBotSettings,
  type ProjectBotSettings,
  type TelegramBotIdentity,
} from "./config.ts";
import { TelegramApiError } from "./telegram.ts";

interface TelegramApiEnvelope<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}

interface TelegramUser {
  id: number;
  is_bot: boolean;
  username?: string;
  can_manage_bots?: boolean;
}

interface TelegramMessage {
  text?: string;
  chat: { id: number; type: string };
  from?: TelegramUser;
}

interface ManagedBotUpdated {
  user: TelegramUser;
  bot: TelegramUser;
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  managed_bot?: ManagedBotUpdated;
}

export interface ValidatedBot extends TelegramBotIdentity {
  canManageBots: boolean;
}

export type ConfiguredProjectBot = Omit<ProjectBotSettings, "sessionId">;

export interface ManagedBotResult {
  settings?: ConfiguredProjectBot;
  nextOffset?: number;
  observedBots: KnownManagedBot[];
}

export async function callTelegramBotApi<T>(
  token: string,
  method: string,
  body: Record<string, unknown> = {},
  signal: AbortSignal = AbortSignal.timeout(20_000),
): Promise<T> {
  const response = await fetch(
    `https://api.telegram.org/bot${token}/${method}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    },
  ).catch(() => {
    throw new Error(`Telegram transport ${method} failed.`);
  });
  let envelope: TelegramApiEnvelope<T> | undefined;
  try {
    envelope = (await response.json()) as TelegramApiEnvelope<T>;
  } catch {
    // Keep the token-bearing request URL out of transport errors.
  }
  if (!response.ok || !envelope?.ok || envelope.result === undefined) {
    throw new TelegramApiError(
      method,
      envelope?.description || `HTTP ${response.status}`,
      envelope?.error_code,
    );
  }
  return envelope.result;
}

export async function validateBotToken(
  tokenInput: string,
  expectedUsername?: string,
  requireManager = false,
  signal: AbortSignal = AbortSignal.timeout(20_000),
): Promise<ValidatedBot> {
  const token = tokenInput.trim();
  if (!token) throw new Error("Telegram bot token is required.");
  const user = await callTelegramBotApi<TelegramUser>(
    token,
    "getMe",
    {},
    signal,
  );
  if (!user.is_bot || !user.username) {
    throw new Error("Telegram getMe did not return a valid bot identity.");
  }
  const username = normalizeBotUsername(user.username);
  if (
    expectedUsername &&
    normalizeBotUsername(expectedUsername).toLowerCase() !==
      username.toLowerCase()
  ) {
    throw new Error(
      `The token belongs to @${username}, not @${normalizeBotUsername(expectedUsername)}.`,
    );
  }
  if (requireManager && user.can_manage_bots !== true) {
    throw new Error(`@${username} is not enabled to manage bots.`);
  }
  return {
    id: String(user.id),
    username,
    canManageBots: user.can_manage_bots === true,
  };
}

export function createManagedBotUrl(
  managerUsername: string,
  botUsername: string,
  displayName: string,
): string {
  return `https://t.me/newbot/${encodeURIComponent(normalizeBotUsername(managerUsername))}/${encodeURIComponent(normalizeBotUsername(botUsername))}?name=${encodeURIComponent(displayName.trim() || normalizeBotUsername(botUsername))}`;
}

export async function findManagedBot(
  manager: ManagerBotSettings,
  expectedUsername: string,
  signal: AbortSignal,
): Promise<ManagedBotResult> {
  const username = normalizeBotUsername(expectedUsername);
  const webhook = await callTelegramBotApi<{ url: string }>(
    manager.token,
    "getWebhookInfo",
    {},
    signal,
  );
  if (webhook.url)
    throw new Error(
      "Confirm manager webhook takeover in local setup before polling.",
    );
  const updates = await callTelegramBotApi<TelegramUpdate[]>(
    manager.token,
    "getUpdates",
    {
      ...(manager.updateOffset === undefined
        ? {}
        : { offset: manager.updateOffset }),
      limit: 100,
      timeout: 2,
      allowed_updates: ["managed_bot"],
    },
    signal,
  );

  let nextOffset = manager.updateOffset;
  let match: ManagedBotUpdated | undefined;
  const observedBots: KnownManagedBot[] = [];
  for (const update of updates) {
    nextOffset = Math.max(nextOffset ?? 0, update.update_id + 1);
    const managed = update.managed_bot;
    if (
      !managed?.bot.username ||
      !managed.user ||
      managed.user.is_bot ||
      !Number.isSafeInteger(managed.user.id) ||
      !Number.isSafeInteger(managed.bot.id)
    ) {
      continue;
    }
    observedBots.push({
      id: String(managed.bot.id),
      username: normalizeBotUsername(managed.bot.username),
      ownerUserId: String(managed.user.id),
      lastSeenAt: new Date().toISOString(),
    });
    if (managed.bot.username.toLowerCase() === username.toLowerCase()) {
      match = managed;
    }
  }
  if (!match) return { nextOffset, observedBots };
  const settings = await getManagedBotSettings(
    manager,
    {
      id: String(match.bot.id),
      username,
      ownerUserId: String(match.user.id),
    },
    signal,
  );
  return { nextOffset, observedBots, settings };
}

export async function getManagedBotToken(
  manager: ManagerBotSettings,
  botId: string,
  expectedUsername: string,
  signal: AbortSignal,
): Promise<{ id: string; username: string; token: string }> {
  const managedBotId = Number(botId);
  if (!Number.isSafeInteger(managedBotId) || managedBotId <= 0) {
    throw new Error("The managed bot ID must be a Telegram numeric ID.");
  }
  const token = await callTelegramBotApi<string>(
    manager.token,
    "getManagedBotToken",
    { user_id: managedBotId },
    signal,
  );
  const identity = await validateBotToken(
    token,
    expectedUsername,
    false,
    signal,
  );
  if (identity.id !== botId) {
    throw new Error(
      "The managed-bot token does not match the selected bot ID.",
    );
  }
  return { id: identity.id, username: identity.username, token };
}

export async function restrictManagedBotAccess(
  manager: ManagerBotSettings,
  botId: string,
  signal: AbortSignal,
): Promise<void> {
  const managedBotId = Number(botId);
  if (!Number.isSafeInteger(managedBotId) || managedBotId <= 0) {
    throw new Error("The managed bot ID must be a Telegram numeric ID.");
  }
  await callTelegramBotApi<boolean>(
    manager.token,
    "setManagedBotAccessSettings",
    {
      user_id: managedBotId,
      is_access_restricted: true,
      added_user_ids: [],
    },
    signal,
  );
}

export async function getManagedBotSettings(
  manager: ManagerBotSettings,
  knownBot: Pick<KnownManagedBot, "id" | "username" | "ownerUserId">,
  signal: AbortSignal,
): Promise<ConfiguredProjectBot> {
  const recovered = await getManagedBotToken(
    manager,
    knownBot.id,
    knownBot.username,
    signal,
  );
  await restrictManagedBotAccess(manager, knownBot.id, signal);
  return {
    ...recovered,
    ownerUserId: knownBot.ownerUserId,
    managed: true,
  };
}

export async function pairManualBot(
  token: string,
  username: string,
  onCode: (code: string) => void,
  signal: AbortSignal,
): Promise<ConfiguredProjectBot> {
  const identity = await validateBotToken(token, username, false, signal);
  const webhook = await callTelegramBotApi<{ url: string }>(
    token,
    "getWebhookInfo",
    {},
    signal,
  );
  if (webhook.url)
    throw new Error(
      "Confirm bot webhook takeover in local setup before pairing.",
    );
  const initial = await callTelegramBotApi<TelegramUpdate[]>(
    token,
    "getUpdates",
    { offset: -1, limit: 1, timeout: 0, allowed_updates: ["message"] },
    signal,
  );
  let offset = initial.at(-1)?.update_id;
  if (offset !== undefined) offset += 1;

  const code = `pair-${randomInt(100_000, 1_000_000)}`;
  onCode(code);
  while (!signal.aborted) {
    const updates = await callTelegramBotApi<TelegramUpdate[]>(
      token,
      "getUpdates",
      {
        ...(offset === undefined ? {} : { offset }),
        limit: 20,
        timeout: 10,
        allowed_updates: ["message"],
      },
      signal,
    );
    for (const update of updates) {
      offset = update.update_id + 1;
      const message = update.message;
      if (
        message?.text?.trim() === code &&
        message.chat.type === "private" &&
        message.from &&
        !message.from.is_bot &&
        message.chat.id === message.from.id
      ) {
        return {
          id: identity.id,
          username: identity.username,
          token: token.trim(),
          ownerUserId: String(message.from.id),
          managed: false,
        };
      }
    }
  }
  throw signal.reason instanceof Error
    ? signal.reason
    : new Error("Telegram owner pairing was cancelled.");
}
