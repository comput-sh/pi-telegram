import { randomInt } from "node:crypto";

import {
  normalizeBotUsername,
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

export interface ManagedBotResult {
  settings?: ProjectBotSettings;
  nextOffset?: number;
}

export async function callTelegramBotApi<T>(
  token: string,
  method: string,
  body: Record<string, unknown> = {},
  signal: AbortSignal = AbortSignal.timeout(20_000),
): Promise<T> {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
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
  const user = await callTelegramBotApi<TelegramUser>(token, "getMe", {}, signal);
  if (!user.is_bot || !user.username) {
    throw new Error("Telegram getMe did not return a valid bot identity.");
  }
  const username = normalizeBotUsername(user.username);
  if (
    expectedUsername &&
    normalizeBotUsername(expectedUsername).toLowerCase() !== username.toLowerCase()
  ) {
    throw new Error(`The token belongs to @${username}, not @${normalizeBotUsername(expectedUsername)}.`);
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
  await callTelegramBotApi<boolean>(
    manager.token,
    "deleteWebhook",
    { drop_pending_updates: false },
    signal,
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
  for (const update of updates) {
    nextOffset = Math.max(nextOffset ?? 0, update.update_id + 1);
    const managed = update.managed_bot;
    if (
      managed?.bot.username &&
      managed.bot.username.toLowerCase() === username.toLowerCase()
    ) {
      match = managed;
    }
  }
  if (!match) return { nextOffset };
  if (!match.user || match.user.is_bot || !Number.isSafeInteger(match.user.id)) {
    throw new Error("Telegram returned an invalid managed-bot owner.");
  }

  const managedBotId = match.bot.id;
  const token = await callTelegramBotApi<string>(
    manager.token,
    "getManagedBotToken",
    { user_id: managedBotId },
    signal,
  );
  const identity = await validateBotToken(token, username, false, signal);
  if (identity.id !== String(managedBotId)) {
    throw new Error("The managed-bot token does not match Telegram's managed-bot update.");
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

  return {
    nextOffset,
    settings: {
      version: 1,
      id: identity.id,
      username: identity.username,
      token,
      ownerUserId: String(match.user.id),
      managed: true,
    },
  };
}

export async function pairManualBot(
  token: string,
  username: string,
  onCode: (code: string) => void,
  signal: AbortSignal,
): Promise<ProjectBotSettings> {
  const identity = await validateBotToken(token, username, false, signal);
  await callTelegramBotApi<boolean>(
    token,
    "deleteWebhook",
    { drop_pending_updates: false },
    signal,
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
          version: 1,
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
