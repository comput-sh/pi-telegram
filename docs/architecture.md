# Architecture

## Product boundary

TelegramPi has two required projects:

1. **Bot Registry and Provisioner** — a C#/.NET 10 isolated-worker Azure Functions service that creates or retrieves a project bot.
2. **Pi Telegram extension** — a Pi package that owns the live Telegram connection for one Pi session.

A skill is optional and must never own credentials, provisioning state, authorization, or transport.

## Provisioning flow

```text
Provisioning client
  -> POST /api/bots { projectName }
  <- existing token, or pending record + managed-bot creation URL

User opens the URL and confirms the prefilled bot in Telegram
  -> Telegram sends managed_bot update to the setup-bot webhook
  -> Provisioner calls getManagedBotToken
  -> Provisioner restricts access to the Telegram owner
  -> Provisioner stores the token and marks the record ready

Pi extension session startup
  -> when .telegrampi.json exists: GET /api/bots/{projectKey} and verify botUsername
  -> otherwise: POST /api/bots/lookup { projectName }
  <- ready record + token, or 404 without creating anything

User explicitly asks the agent to enable Telegram
  -> model invokes globally registered telegram_enable
  -> existing binding/record is reused without prompting
  -> for a new project, extension asks the user to accept the derived username or provide a custom one
  -> POST /api/bots { projectName, botUsername }
  <- ready bot and immediate connection, or pending setup URL
  -> extension writes non-secret .telegrampi.json after the service accepts the bot
  -> after owner confirmation, invoking telegram_enable again connects the session
```

The project folder name drives the suggested naming. With the public default prefix `pi`, project `TelegramPi` becomes `piTelegramPiBot`; long names are deterministically shortened to Telegram's 32-character limit. A user may instead provide a valid custom bot username during first provisioning. The resulting `.telegrampi.json` stores the stable project key and actual username, not credentials.

## Runtime flow

The extension implements a deliberately small lifecycle:

- One Pi session owns one Telegram `getUpdates` connection.
- The package is installed in user-level Pi settings and is available in every project.
- Session start uses only read-only lookup: stable project-key lookup from `.telegrampi.json` when present, otherwise legacy folder-name lookup. It returns immediately unless a ready token exists.
- The globally registered `telegram_enable` tool performs provisioning only after an explicit user request. Existing bots are bound without prompting; genuinely new projects require an explicit derived/custom username choice. A later explicit custom choice may replace a still-pending username and binding, while ready bot usernames remain immutable. The tool writes the accepted non-secret binding, returns a safe owner-confirmation link for pending bots, or connects a ready bot immediately.
- After connecting, it sends the Telegram owner a startup summary with project name, Git branch when the working directory is in a repository, hostname/IP, and concise follow-up/steering/cancellation instructions.
- Session shutdown aborts and awaits polling immediately.
- Ordinary Telegram input uses `deliverAs: "followUp"`. A leading `!` is stripped and explicitly selects `deliverAs: "steer"`; `!!` escapes a literal leading bang. Either mode starts immediately when Pi is idle. Each input is prefixed with the Telegram Rich Markdown contract.
- Source tracking routes output back only for Telegram-originated requests; responses to local Pi requests remain local.
- An ephemeral `sendRichMessageDraft` immediately displays a native `Thinking…` block with an `AIActions` custom emoji. Generic tool activity may update that Rich draft only before public progress exists.
- The first public `commentary` delta replaces the same stable draft ID with a whitespace-flattened one-line plain preview. Further commentary replaces that line at a coalesced 1.5-second cadence; tool events never switch it back to generic Thinking.
- An invisibly changing payload heartbeat refreshes both Rich and plain drafts every five seconds; mobile expired inactive drafts after roughly eight seconds and ignored identical refresh payloads during testing.
- When text marked with Pi's `final_answer` phase begins, it replaces the same plain draft and continues streaming at the coalesced 1.5-second cadence.
- Draft creation follows Pi's resulting user-message lifecycle rather than being started speculatively by the polling callback.
- Native `can_stop` is disabled because its animated control disrupts mobile rendering. The owner's exact case-insensitive `stop` keyword invokes `ctx.abort()` for the current Telegram-requested task without closing the session.
- On connection, the extension configures an owner-chat command menu containing `/help`, `/status`, `/steer`, `/stop`, and `/reload`. Transport commands bypass the model. Telegram `/reload` is rejected with a clear response while `ctx.isIdle()` is false; while idle, it invokes an internal Pi extension command, uses `ctx.reload()`, and reconnects through the standard shutdown/startup lifecycle.
- At `message_end`, each completed assistant response is persisted immediately with `sendRichMessage` as its own normal unquoted Rich Markdown message. `agent_settled` remains a fallback boundary.
- For Telegram-originated requests, `telegram_send_file` can upload a requested project artifact through native `sendDocument`. Canonical path checks confine access to the active project and reject credential-like or repository-internal files; cloud Bot API uploads are limited to 50 MB and captions to 1,024 characters.
- Rich Markdown enables native headings, lists, tables, links, quotations, code, details, footnotes, formulas, and media with a 32,768-character limit and no fallback.
- Telegram polling and delivery are asynchronous; Pi agent execution remains sequential.
- Public `commentary` and `final_answer` text deltas are coalesced into the evolving draft. Hidden reasoning/thinking deltas, raw tool arguments/results, and prompts are not delivered.

Concurrent Pi sessions using the same project bot are unsupported in v1 and will fail clearly rather than introducing leader/follower coordination.

## Security boundary

- Provisioner client routes use Azure Function-key authentication.
- Telegram's webhook route is anonymous at Azure's edge but verifies `X-Telegram-Bot-Api-Secret-Token`.
- Managed bots are configured with restricted access; their owner is always allowed.
- Bot tokens are never written to service logs or model context.
- Local development uses whichever Azure Storage connection is configured in ignored `local.settings.json`; pointing it at production storage will modify the production bot registry.
- Azure Storage and Function App settings provide platform encryption at rest. Additional application-level token encryption can be introduced later.

## References

- [Telegram Managed Bots](https://core.telegram.org/api/bots/managed-bots)
- [Telegram Bot API](https://core.telegram.org/bots/api)
- [.NET isolated worker guide](https://learn.microsoft.com/azure/azure-functions/dotnet-isolated-process-guide)
- [Azure Tables client library for .NET](https://learn.microsoft.com/dotnet/api/overview/azure/data.tables-readme)
