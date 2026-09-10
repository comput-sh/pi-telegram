# Bot Registry and Provisioner

Project: [`provisioner/`](../provisioner/)

The optional provisioner is a .NET 10 isolated-worker Azure Functions v4 service backed by Azure Table Storage. It creates or retrieves project-specific Telegram managed bots and returns ready bot credentials only to Function-key-authenticated clients.

## Prerequisites

- An Azure subscription
- Azure Functions Core Tools
- .NET 10 SDK
- A Telegram setup bot with Bot Management Mode and bot-to-bot communication enabled
- A publicly reachable HTTPS Function App for Telegram webhooks

## Application settings

| Setting | Purpose |
|---|---|
| `AzureWebJobsStorage` | Function runtime storage and default bot-table storage connection |
| `BOT_STORAGE_CONNECTION_STRING` | Optional separate bot-table connection |
| `BOT_TABLE_NAME` | Table name; defaults to `TelegramPiBots` |
| `BOT_USERNAME_PREFIX` | Suggested managed-bot username prefix |
| `TELEGRAM_SETUP_BOT_USERNAME` | Setup-bot username without `@` |
| `TELEGRAM_SETUP_BOT_TOKEN` | Setup-bot token |
| `TELEGRAM_WEBHOOK_SECRET` | Random webhook verification secret |
| `TELEGRAM_BOT_API_BASE_URL` | Optional Bot API base URL override |

Keep all values in Function App settings or ignored `local.settings.json`. Never commit tokens, Function keys, webhook secrets, or storage connection strings.

## Build and test

```powershell
cd provisioner
dotnet restore BotProvisioner.csproj
dotnet build BotProvisioner.csproj --configuration Release
dotnet test tests\BotProvisioner.Tests.csproj --configuration Release
dotnet list BotProvisioner.csproj package --vulnerable --include-transitive
```

## Run locally

Copy `local.settings.example.json` to ignored `local.settings.json`, replace placeholders, then run:

```powershell
func start --port 7071
```

If a Function App is already configured, synchronize its settings without printing them:

```powershell
.\scripts\Sync-LocalSettings.ps1 `
  -ResourceGroup <resource-group> `
  -FunctionApp <function-app>
```

Local health check:

```powershell
curl http://127.0.0.1:7071/api/health
```

Telegram cannot call a localhost webhook. Do not approve a managed-bot creation link until the deployed webhook is registered.

## Deploy

Create your own storage account and Linux Flex Consumption Function App, configure the settings above, then publish:

```powershell
func azure functionapp publish <function-app>
```

Register Telegram's webhook using a Function key:

```powershell
curl -X POST "https://<function-app>.azurewebsites.net/api/telegram/webhook/register?code=<function-key>" `
  -H "Content-Type: application/json" `
  -d '{}'
```

Verify:

```powershell
curl https://<function-app>.azurewebsites.net/api/health
curl "https://<function-app>.azurewebsites.net/api/telegram/manager?code=<function-key>"
```

The manager response must report the configured setup-bot username and `canManageBots: true`.

Configure the extension with:

```json
{
  "provisionerUrl": "https://<function-app>.azurewebsites.net/api",
  "apiKey": "<function-key>"
}
```

## Production warning

A shared Function key is suitable for a private or self-hosted deployment, not a public multi-tenant hosted service. A public hosted provisioner requires per-user/device authorization before returning managed-bot tokens.
