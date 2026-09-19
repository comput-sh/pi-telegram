# Pi Telegram

Use Telegram as a native frontend for live [Pi coding-agent](https://github.com/earendil-works/pi-mono) sessions.

Pi Telegram supports multiple project bots, persistent Pi-session assignments, owner-only input, explicit follow-up and steering semantics, native activity drafts, concise public progress, Rich Markdown final answers, cancellation, command menus, and project-file attachments.

## Release status

**0.2.1** simplifies startup notifications to `Connected · ProjectName · IP`, retaining full details in `/status`. It includes the multi-bot and hardened lifecycle features introduced in 0.2.0. Publication uses GitHub Actions Trusted Publishing with signed provenance.

The release passed TypeScript validation and 70 automated tests. Live two-session Telegram smoke testing of the new lifecycle remains pending. See the [npm package](https://www.npmjs.com/package/@comput/pi-telegram) for current availability.

## Install

```bash
pi install npm:@comput/pi-telegram
```

Alternatively, install the current source directly from GitHub:

```bash
pi install git:github.com/mbundgaard/PiTelegram
```

Start a new Pi session or run `/reload` after installation. Installation is global but startup is passive: Pi Telegram does not prompt, provision, or contact Telegram unless a bot is already assigned to the current persistent Pi session. Interactive setup requires Pi's local terminal UI; masked token setup is not available through RPC or non-interactive modes.

## Start Telegram

Run:

```text
/telegram-start
```

Or explicitly ask the agent to start Telegram; the `telegram_start` tool opens the same local UI.

- The first menu shows configured bots, **Add a bot…**, **Manage bots…**, and **Cancel**.
- **Add a bot…** offers BotFather setup, managed creation/completion, and known managed-bot imports.
- **Manage bots…** contains status, release, removal, manager configuration, pending-request cancellation, and numeric-ID recovery.

Transfers require confirmation. If assignments change while a dialog is open, setup stops and asks you to start again with the current state. Escape cancels each setup step, including the display-name prompt and private pairing.

Within a project, one Pi session can be assigned one bot, and each bot entry has one persistent session assignment. Host-local runtime leases also prevent two local processes from polling the same bot. Assignments in separate project files or on different machines are not globally synchronized; release the old integration before moving a bot between projects or hosts. The assignment uses `ctx.sessionManager.getSessionId()`, so resuming that Pi session reconnects its bot while other sessions remain inactive.

Use `/telegram-release` or ask the agent to release Telegram to stop polling and clear only the current session assignment. Credentials remain available for later selection. Use `/telegram-remove-bot` only when you also want to delete a selected bot's locally stored project credentials; it does not revoke or delete the Telegram bot.

## Bot setup

### Manager mode

Choose **Add a bot… → Create managed bot** or configure the manager directly with `/telegram-setup-manager`. Enter the manager username and token in Pi's local setup UI. Token input is masked and validated with Telegram's `getMe`; the bot must report `can_manage_bots: true`.

The manager configuration is stored globally:

```text
~/.pi/agent/pi-telegram/settings.json
```

`PI_TELEGRAM_SETTINGS` can override this global settings path.

Choose the exact username for each new managed bot. Pi Telegram never derives, hashes, truncates, prefixes, or otherwise chooses usernames from project names. Telegram requires the owner to approve the generated managed-bot creation link. Start Telegram again after approval to complete setup.

The global manager settings maintain a best-effort catalog of managed bot IDs, usernames, and owner IDs observed in Telegram updates. Child tokens are never stored in that catalog. Telegram has no API for listing every managed bot or resolving an arbitrary private bot username; token retrieval requires a numeric bot ID. If a bot is missing from the catalog but you know its ID and exact username, the recovery flow retrieves and validates its token, restricts access, and performs private owner pairing.

### Manual BotFather mode

Choose **Add a bot… → Add BotFather bot** or run `/telegram-setup-bot`. Enter the exact username and BotFather token in local UI. Pi Telegram validates the token with `getMe`, confirms that local polling may remove an existing webhook, then displays a one-time pairing code. Open the bot in Telegram, press **Start**, and send the exact code to establish the authorized owner.

A regular BotFather bot can be restored after reinstall by adding its username and token again. Re-adding an already paired bot in the same project preserves its stored owner instead of pairing again; to change the owner, explicitly remove the local bot entry and add it again. Tokens are never accepted through model tool arguments or chat.

### Commands

| Local Pi command | Purpose |
|---|---|
| `/telegram-start` | Select, create, add, or transfer a bot and start it in this Pi session |
| `/telegram-release` | Disconnect and unassign the current session's bot without deleting it |
| `/telegram-status` | Show this session's assignment and connection state |
| `/telegram-remove-bot` | Remove a selected bot's assignment and local project credentials |
| `/telegram-setup` | Choose manager or manual provisioning mode |
| `/telegram-setup-manager` | Configure or replace the global manager bot |
| `/telegram-setup-bot` | Add a manual bot and assign it to this session |
| `/telegram-cancel-managed-bot` | Cancel a pending managed-bot request |

## Project configuration

Each project stores all of its private bot connections in:

```text
<project>/.pi/pi-telegram.local.json
```

```json
{
  "version": 2,
  "bots": [
    {
      "id": "987654321",
      "username": "MyChosenBot",
      "token": "<secret>",
      "ownerUserId": "123456789",
      "managed": false,
      "sessionId": "persistent-pi-session-id"
    }
  ]
}
```

An unassigned bot has `"sessionId": null`. Existing version-1 project settings load as one unassigned bot and are rewritten as version 2 when selected.

Bot IDs and canonical usernames come from Telegram. Before writing credentials, Pi Telegram rejects tracked or symbolic paths and adds the project settings path to the repository's local Git exclude list. Never commit or share it.

There is no cloud registry, Azure service, deterministic project key, or tracked bot binding.

## Transfers and runtime ownership

Moving a bot assigned to another persistent Pi session requires local confirmation and an atomic comparison of the configuration that was confirmed. The old process checks ownership every second, stops polling when ownership changes or cannot be verified, and releases the bot. The new process waits briefly for that handoff.

Failed switches restore the previous assignment and attempt to reconnect its bot, unless another session has since changed the configuration. Release and removal still clean up locally when Telegram's confirmation message cannot be sent.

Private heartbeat leases from `proper-lockfile` protect both pairing and normal polling. Settings locks also renew while operations are active. Abandoned locks become recoverable after two minutes without a heartbeat; do not manually remove locks while Pi processes are running. When upgrading from the earlier PID-lock implementation, release or reload old processes first.

Startup never removes a newly configured webhook: use `/telegram-start` to explicitly confirm takeover. Telegram's `409 Conflict` response remains a secondary safeguard.

## Telegram controls

| Input | Behavior |
|---|---|
| Normal message | Starts a separate follow-up request |
| `!message` | Steers active work |
| `!!message` | Sends a literal leading `!` |
| `stop` or `/stop` | Cancels the current Telegram task |
| `/status` | Shows project, branch when available, hostname/IP, and controls |
| `/steer message` | Same steering behavior as `!message` |
| `/reload` | Reloads Pi while idle |
| `/help` | Shows Pi Telegram controls |

## Responses

- When Pi starts processing a Telegram request, Telegram shows a native Rich Thinking or tool-activity draft. Queued follow-ups do not start their own draft until processed.
- The first public commentary replaces that draft with one evolving plain progress line.
- Tool activity never switches back to generic Thinking after public progress appears.
- Only public commentary and final-answer text are streamed; hidden reasoning and raw tool traffic stay private.
- In-memory, one-use request receipts bind replies to the receiving connection; a copied transport notice alone cannot redirect console output.
- Telegram steering is rejected while a local-console task is running; normal messages can queue a separate request.
- Stop tracks the active Telegram request independently of draft rendering.
- Background draft delivery failures produce rate-limited local warnings.
- Completed responses are persisted as native Telegram Rich Messages.

## File attachments

During a Telegram-originated request, ask Pi to send a generated or existing project file. The `telegram_send_file` tool uploads it as a native Telegram document.

Safeguards include canonical paths restricted to the active project, blocked credential and repository-internal files (including configured global settings and temporary credential files), revalidation immediately before reading the attachment, Telegram's 50 MB cloud Bot API upload limit, and optional plain-text captions up to 1,024 characters.

## Development

```bash
npm ci
npm run validate
npm audit --audit-level=moderate
npm run pack:check
```

Run from source:

```bash
pi -e .
```

See [`docs/architecture.md`](docs/architecture.md) and [`docs/telegram-rich-messages.md`](docs/telegram-rich-messages.md) for implementation details.

## Security

Pi packages run with full system access. Review source before installation. Pi Telegram accepts only private text from the paired owner and never sends hidden reasoning or raw tool results to Telegram.

Credential files contain plaintext tokens, not encrypted secrets. Protect them with appropriate OS permissions and secure backups. Bot chats are not end-to-end encrypted; public responses and requested attachments pass through Telegram. Startup messages use a single line: `Connected · ProjectName · IP`. They disclose the project name and an IP address to the paired owner; `/status` additionally includes the branch when available, hostname, and controls. Attachment path/filename checks are not a content-level secret scanner.

Report vulnerabilities privately as described in [`SECURITY.md`](SECURITY.md).

## License

[MIT](LICENSE)
