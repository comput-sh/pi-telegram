# Pi Telegram Extension

Use Telegram as a native frontend for live [Pi coding-agent](https://github.com/badlogic/pi-mono) sessions.

TelegramPi connects one project-specific Telegram bot to one live Pi session. It supports owner-only input, explicit follow-up and steering semantics, native activity drafts, concise public progress, Rich Markdown final answers, cancellation, command menus, and project-file attachments.

## Install

```bash
pi install npm:pi-telegram-extension
```

To try it without installing:

```bash
pi -e npm:pi-telegram-extension
```

Until the first npm release, install directly from GitHub:

```bash
pi install git:github.com/mbundgaard/PiTelegramExtension
```

Start a new Pi session or run `/reload` after installation.

## Configure

TelegramPi requires a bot provisioner. You can deploy the included [.NET Azure Functions provisioner](provisioner/) or point the extension at a compatible service.

Create `~/.pi/agent/telegrampi.json`:

```json
{
  "provisionerUrl": "https://your-function-app.example/api",
  "apiKey": "<your-function-key>",
  "botUsernamePrefix": "pi"
}
```

`botUsernamePrefix` is optional and defaults to `pi`; configure the provisioner with the same prefix. Alternatively, set both `TELEGRAMPI_PROVISIONER_URL` and `TELEGRAMPI_API_KEY`, plus optional `TELEGRAMPI_BOT_USERNAME_PREFIX`. `TELEGRAMPI_CONFIG` may point to another JSON configuration file.

Never place Function keys or bot tokens in a repository. The public package does not include access to a hosted provisioner.

## Enable a project

In any project, tell Pi:

> Enable Telegram integration.

For a new project, the extension asks whether to use its suggested bot username or a custom Telegram bot username. After the provisioner accepts the selection, TelegramPi writes a non-secret `.telegrampi.json` binding containing only:

```json
{
  "version": 1,
  "projectKey": "example-12345678",
  "botUsername": "exampleProjectBot"
}
```

This file can be committed. It makes the project-to-bot association portable across clones and folder renames.

Telegram requires the owner to approve managed-bot creation and press **Start** before a newly created bot can send private messages.

## Telegram controls

| Input | Behavior |
|---|---|
| Normal message | Starts a separate follow-up request |
| `!message` | Steers active work |
| `!!message` | Sends a literal leading `!` |
| `stop` or `/stop` | Cancels the current Telegram task |
| `/status` | Shows the connected project/session |
| `/reload` | Reloads Pi while idle |
| `/help` | Shows TelegramPi controls |

## Responses

- Telegram immediately shows a native Rich Thinking or tool-activity draft.
- The first public commentary replaces that draft with one evolving plain progress line.
- Tool activity never switches back to generic Thinking after public progress appears.
- Only public commentary and final-answer text are streamed; hidden reasoning and raw tool traffic stay private.
- Completed responses are persisted as native Telegram Rich Messages with headings, tables, lists, code, details, formulas, and media support.

## File attachments

During a Telegram-originated request, ask Pi to send a generated or existing project file. The extension exposes `telegram_send_file`, which uploads it as a native Telegram document.

Safeguards include:

- canonical paths restricted to the active project;
- blocked credential, private-key, environment, and `.git` files;
- Telegram's 50 MB cloud Bot API upload limit; and
- optional plain-text captions up to 1,024 characters.

## Development

```bash
npm install
npm run validate
```

Run from source:

```bash
pi -e .
```

Provisioner validation:

```bash
cd provisioner
dotnet build BotProvisioner.csproj --configuration Release
dotnet test tests/BotProvisioner.Tests.csproj --configuration Release
```

See [`docs/architecture.md`](docs/architecture.md), [`docs/api.md`](docs/api.md), and [`docs/telegram-rich-messages.md`](docs/telegram-rich-messages.md) for implementation details.

## Security

Pi extensions run with full system access. Review source before installation. TelegramPi accepts only private text from the provisioned owner, keeps bot tokens in provisioner storage and session memory, and never sends hidden reasoning or raw tool results to Telegram.

Report vulnerabilities privately as described in [`SECURITY.md`](SECURITY.md).

## License

[MIT](LICENSE)
