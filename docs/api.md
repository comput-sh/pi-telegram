# Bot Provisioner API

Client endpoints use Azure Function-key authentication after deployment. Supply the key as `?code=<function-key>` or the `x-functions-key` header.

## `GET /api/health`

Anonymous health check.

## `POST /api/bots`

Gets an existing project bot or creates a pending provisioning record. The global Pi extension calls this endpoint only through its `telegram_enable` tool after an explicit user request; ordinary session startup never calls it.

Request:

```json
{
  "projectName": "TelegramPi",
  "botUsername": "piCustomTelegramBot"
}
```

`botUsername` is optional. When omitted, the service derives the standard `pi<ProjectName>Bot` username. An explicit username must satisfy Telegram's username rules and end with `Bot`. It is accepted for first provisioning and may replace the username of a still-pending record before owner confirmation. Ready bot usernames cannot be changed. A username already assigned to another registry record is rejected.

New bot response (`202`):

```json
{
  "projectKey": "telegrampi-04faf163",
  "projectName": "TelegramPi",
  "botUsername": "piTelegramPiBot",
  "botDisplayName": "TelegramPi",
  "creationUrl": "https://t.me/newbot/yourSetupBot/piTelegramPiBot?name=TelegramPi",
  "provisioningId": "...",
  "status": "pending"
}
```

Existing ready bots return `200` and additionally include `ownerUserId`, `token`, and a `conversationUrl` such as `https://t.me/piTelegramPiBot?start=telegrampi-04faf163`.

## `POST /api/bots/lookup`

Read-only lookup used by the Pi extension at session start. It never creates a provisioning record.

Request:

```json
{
  "projectName": "TelegramPi"
}
```

Returns `404` when no project bot exists, or `200` with the pending/ready record. A ready response includes the token, owner ID, and conversation URL.

## `GET /api/bots/{projectKey}`

Performs the stable lookup used when a project contains `.telegrampi.json`. It also polls a provisioning record. A pending record returns `200` without a token or conversation URL. A ready record includes the token and a `conversationUrl` that opens the new bot chat.

## `POST /api/telegram/webhook`

Telegram manager-bot webhook. Telegram must provide the configured `X-Telegram-Bot-Api-Secret-Token` header.

The endpoint accepts `managed_bot` updates, retrieves the child bot token, restricts access to the owner, and updates the matching project record. Other update types are acknowledged and ignored.

## `GET /api/telegram/manager`

Returns the setup bot's identity and `canManageBots` status. Requires a Function key after deployment.

## `POST /api/telegram/webhook/register`

Registers the production Telegram webhook. Requires a Function key after deployment.

Optional request:

```json
{
  "webhookUrl": "https://<function-app>.azurewebsites.net/api/telegram/webhook"
}
```

When omitted, the endpoint derives `/api/telegram/webhook` from its own public origin.
