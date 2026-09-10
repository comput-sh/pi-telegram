# Pi Telegram Extension Agent Guide

## Product direction

Make Telegram a first-class frontend for live Pi coding-agent sessions. Prefer native Telegram drafts, Rich Messages, commands, documents, media, and controls when they improve the experience. Native Thinking is a generic status placeholder, never a channel for hidden reasoning.

## Boundaries

- Keep transport, authorization, lifecycle, polling, and credentials in extension/provisioner code.
- Session startup performs read-only lookup and remains inert when no ready bot exists.
- Provision only after an explicit user request through `telegram_enable`.
- One Pi session owns one Telegram `getUpdates` connection.
- Accept only private messages from the stored owner.
- Send Telegram output only for Telegram-originated requests.
- Never expose hidden reasoning, prompts, raw tool arguments/results, or credentials.
- Never commit `telegrampi.json`, bot tokens, Function keys, storage strings, or local Function settings.

## Layout

- `src/` — TypeScript Pi extension.
- `tests/` — extension tests.
- `provisioner/` — optional .NET isolated-worker Azure Functions provisioner.
- `docs/` — architecture, APIs, and Telegram UX findings.

## Validation

```bash
npm run validate

cd provisioner
dotnet build BotProvisioner.csproj --configuration Release
dotnet test tests/BotProvisioner.Tests.csproj --configuration Release
```

After changing an installed local extension, run `/reload` in Pi.
