# Pi Telegram Extension

Use Telegram as a native frontend for live [Pi coding-agent](https://github.com/badlogic/pi-mono) sessions.

Pi Telegram Extension connects one project-specific Telegram bot to one live Pi session. It supports owner-only input, explicit follow-up and steering semantics, native activity drafts, concise public progress, Rich Markdown final answers, cancellation, command menus, and project-file attachments.

## Install

```bash
pi install npm:pi-telegram-extension
```

Until the first npm release, install directly from GitHub:

```bash
pi install git:github.com/mbundgaard/PiTelegramExtension
```

Start a new Pi session or run `/reload` after installation.

## First-time setup

The first interactive run asks whether you have a Telegram **manager bot** that can create managed bots.

### Manager mode

Choose manager mode and enter the manager bot username and token in Pi's local setup UI. The token is hidden while entered and validated with Telegram's `getMe`; the bot must report `can_manage_bots: true`.

The manager configuration is stored globally:

```text
~/.pi/agent/pi-telegram-extension/settings.json
```

The extension can then create a managed bot after the user explicitly chooses its exact username. It never derives, hashes, truncates, or otherwise chooses a username from the project name. Telegram still requires the owner to approve the managed-bot creation link.

### Manual mode

Choose manual mode if you create bots yourself. That decision is saved globally, so the manager question is not shown again. Each unconfigured project asks locally for its manually created bot username and token.

The extension validates the token with `getMe`, then displays a one-time pairing code. Open the bot in Telegram, press **Start**, and send the exact code to establish the authorized owner.

You can change setup later with:

| Local Pi command | Purpose |
|---|---|
| `/telegram-setup` | Choose manager or manual mode |
| `/telegram-setup-manager` | Configure or replace the global manager bot |
| `/telegram-setup-bot` | Configure a manual bot for the current project |
| `/telegram-status` | Show the current connection status |

Tokens are never accepted through model tool arguments or chat.

## Project configuration

Each project stores its complete private bot connection in:

```text
<project>/.pi/pi-telegram-extension.local.json
```

```json
{
  "version": 1,
  "bot": {
    "id": "987654321",
    "username": "MyChosenBot",
    "token": "<secret>",
    "ownerUserId": "123456789",
    "managed": false
  }
}
```

The bot ID and canonical username come from Telegram. The extension adds this path to the local Git exclude file when the project is a Git repository. Never commit or share it.

There is no cloud registry, Azure service, deterministic project key, or tracked bot binding.

## Enable a managed bot

In manager mode, tell Pi:

> Enable Telegram using @MyChosenBot.

If no username was supplied, `telegram_enable` asks for the exact username instead of inventing one. Open the returned approval link, approve creation in Telegram, and ask Pi to enable Telegram again with the same username. The extension obtains and verifies the managed-bot token locally, restricts access, saves the project settings, and connects.

## Telegram controls

| Input | Behavior |
|---|---|
| Normal message | Starts a separate follow-up request |
| `!message` | Steers active work |
| `!!message` | Sends a literal leading `!` |
| `stop` or `/stop` | Cancels the current Telegram task |
| `/status` | Shows the connected project/session |
| `/reload` | Reloads Pi while idle |
| `/help` | Shows Pi Telegram Extension controls |

## Responses

- Telegram immediately shows a native Rich Thinking or tool-activity draft.
- The first public commentary replaces that draft with one evolving plain progress line.
- Tool activity never switches back to generic Thinking after public progress appears.
- Only public commentary and final-answer text are streamed; hidden reasoning and raw tool traffic stay private.
- Completed responses are persisted as native Telegram Rich Messages.

## File attachments

During a Telegram-originated request, ask Pi to send a generated or existing project file. The `telegram_send_file` tool uploads it as a native Telegram document.

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

See [`docs/architecture.md`](docs/architecture.md) and [`docs/telegram-rich-messages.md`](docs/telegram-rich-messages.md) for implementation details.

## Security

Pi extensions run with full system access. Review source before installation. Pi Telegram Extension accepts only private text from the paired owner and never sends hidden reasoning or raw tool results to Telegram.

Report vulnerabilities privately as described in [`SECURITY.md`](SECURITY.md).

## License

[MIT](LICENSE)
