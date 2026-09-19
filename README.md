# Pi Telegram

Use Telegram as a native frontend for live [Pi coding-agent](https://github.com/earendil-works/pi-mono) sessions.

Pi Telegram supports multiple project bots, persistent Pi-session assignments, owner-only input, explicit follow-up and steering semantics, native activity drafts, concise public progress, Rich Markdown final answers, cancellation, command menus, and project-file attachments.

## Release status

**0.2.5** adds automatic assigned-session startup retries and streams public assistant text without waiting for phase metadata. Multiline previews retain a visible activity indicator during tools and pauses. Live reload/update and streaming verification remain pending. The release retains `telegram_ask` question buttons from 0.2.4. It includes the incoming documents/photos, working-status fixes, setup shortcuts and update notifications introduced in 0.2.3. It retains inline photo delivery and the multi-bot/session safeguards from previous releases. Publication uses GitHub Actions Trusted Publishing with signed provenance.

See [CHANGELOG.md](CHANGELOG.md) for versioned changes, upgrade notes and limitations. It is included in the npm package so agents can read the changes between their installed and target versions; update checks do not automatically inject release notes into agent context.

Validation covers TypeScript and automated tests. Live question-button, two-session lifecycle, inline-photo, setup-completion and update-button/install smoke testing remain pending. See the [npm package](https://www.npmjs.com/package/@comput/pi-telegram) for current availability.

## Install

```bash
pi install npm:@comput/pi-telegram
```

Alternatively, install the current source directly from GitHub:

```bash
pi install git:github.com/mbundgaard/PiTelegram
```

Start a new Pi session or run `/reload` after installation. Installation is global but startup is passive: Pi Telegram does not prompt, provision, or contact Telegram unless a bot is already assigned to the current persistent Pi session. Interactive setup requires Pi's local terminal UI; masked token setup is not available through RPC or non-interactive modes.

## Questions with buttons

During a Telegram-originated request, the agent can use `telegram_ask` to send a Rich Markdown question with 1–8 custom inline buttons. Each option has a visible `label` (up to 64 characters) and a `reply` (up to 1,024 characters). The question can contain up to 4,096 characters.

Only the paired owner can select an option. The selected question, label and reply re-enter the same connection's authenticated input path as a normal follow-up, never as a steering command. Sending the question does not grant approval or block the tool waiting for an answer.

Only one question is active per connection. A new question, typed answer, stop, disconnect or 15-minute expiry invalidates it; keyboard removal is best-effort if Telegram is unreachable. Duplicate and stale clicks are rejected. You can always type an answer instead. Button labels must be distinct. Replies or disconnects during a slow question send prevent its buttons from becoming active afterward. If routing a selection fails, Telegram reports uncertain delivery without automatically retrying it. Buttons do not replace local setup/security confirmation dialogs. Live Rich Message/button testing remains pending after reload.

## Update notifications

Startup notifications include the **loaded extension version**: `Connected · ProjectName · IP · v0.2.3`.

On each session startup/reload, Pi Telegram checks npm's `latest` stable release in the background (eight-second timeout). A failed check does not prevent connection, and no “up to date” message is sent. `PI_OFFLINE` disables the check. Unassigned sessions remain silent and do not connect to Telegram.

Connected owners with a newer version available receive **Update to vX.Y.Z** and **Not now** buttons. Approval is bound to that live connection and offered version; unauthorized, duplicate, or stale clicks cannot install anything. Installation waits until Pi is idle, then reloads only the approving session. Other sessions using the same npm installation pick up the update when they reload; they are not restarted automatically. “Not now” dismisses the offer until a future startup check.

Automatic installation supports standard Pi global/project npm locations using the default npm CLI. Local source/Git checkouts, symlinked packages, pinned Pi package sources, custom package-manager configurations, and unrecognized installations receive a notification only and must be updated locally. Installation uses the exact approved version from the public npm registry and a host-local heartbeat lock to serialize Pi Telegram update attempts. npm errors/output are not forwarded to Telegram. A failed or interrupted installation is not automatically retried or rolled back; inspect/repair it locally before retrying. Reload and live update-button/install smoke testing remain pending.

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

Choose the exact username for each new managed bot. Pi Telegram never derives, hashes, truncates, prefixes, or otherwise chooses usernames from project names. Telegram requires the owner to approve the generated managed-bot creation link. After creating the bot and pressing **Start** in Telegram, tell the initiating agent **“done”**. The `telegram_complete_setup` tool checks the real Telegram creation update and completes setup without reopening the Add menu. Alternatively, use `/telegram-complete-setup` or the first **Complete @BotName** option in `/telegram-start`.

Pending creation is bound to the initiating project and persistent Pi session. If the update has not arrived, completion reports that it is still waiting; it never creates a replacement request. “Done” is interpreted conversationally in setup context, not intercepted globally. Local interactive UI is still required for any webhook or transfer confirmations. Older pending requests without session ownership can be recovered through **Add a bot… → Complete**, with explicit local confirmation.

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
| `/telegram-complete-setup` | Complete this session's pending managed-bot request without menus |
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

During a Telegram-originated request, ask Pi to send a generated or existing project file. The `telegram_send_file` tool uploads it as a native Telegram document, preserving the original bytes.

`telegram_send_photo` is available for explicitly requested inline PNG/JPEG previews. Photos must be at most 10 MB, have width + height at most 10,000 pixels, and an aspect ratio at most 20:1. Actual image contents are decoded and validated before upload. Captions are optional plain text, up to 1,024 characters. Telegram may resize/compress photos; request document delivery for original quality. No automatic conversion, document fallback, or EXIF/GPS metadata removal is performed or promised.

Both tools use the same project-file safeguards and request-bound destination. Cancellation and disconnect abort pending uploads; an interrupted network request may already have reached Telegram, so check the chat before retrying. Success is reported only after Telegram accepts the upload. Albums and automatic resizing are not supported.

Safeguards include canonical paths restricted to the active project, blocked credential and repository-internal files (including configured global settings and temporary credential files), revalidation immediately before reading the attachment, Telegram's 50 MB cloud Bot API upload limit, and optional plain-text captions up to 1,024 characters.

### Receiving files from Telegram

Send a **document or photo** in the paired owner's private bot chat. A caption becomes a normal follow-up instruction with the saved file path. Caption text is not interpreted as a Telegram command or steering prefix. Without a caption, the agent is asked to acknowledge receipt and ask what you want done before inspecting it. Photos use Telegram's largest available size; send images as documents to preserve original bytes.

Downloads show a **Downloading attachment…** acknowledgement, followed by **Received** and a queue notice when Pi is busy. Files are saved with unique sanitized names in `.pi/telegram-inbox/`, protected by an inbox `.gitignore`. Each file is limited to **20 MB** (the hosted Bot API download limit); the inbox is limited to **100 files / 100 MB**. Limits are enforced while streaming, not just from metadata. Files remain until you remove them locally; there is no automatic deletion. Interrupted partial downloads are removed.

Only the stored owner can upload. The receiving connection binds the resulting agent request; a disconnect/transfer cancels pending downloads and cannot route them into a replacement session. Files are untrusted data, never automatically executed or extracted. The downloader rejects symbolic inbox paths and Git-tracked inbox files. File contents are not scanned for secrets or malware.

One attachment can download per connection at a time. Send `/stop` to cancel that download. Additional attachments and ordinary instructions received during a download get an explicit resend notice rather than being silently dropped; albums, voice, audio and video messages are not supported yet. `/status` remains available during downloads. Reload and live document/photo reception tests remain pending.

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
