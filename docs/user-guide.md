# Pi Telegram user guide

[Quick start](../README.md) · [Changelog](../CHANGELOG.md) · [Agent tools](agent-tools.md)

This guide describes **0.6.0**. The separate [agent-tools guide](agent-tools.md) explains the explicit messaging API and migration from 0.5.0.

## Where commands run

- **Terminal:** operating-system shell, before or alongside Pi (`pi install`, `pi -r`).
- **Local Pi:** type into Pi's interactive terminal editor (`/telegram-start`). Setup confirmations and masked credentials stay here.
- **Telegram:** the paired owner's private bot chat (`/status`, normal requests).

Install as a Pi package, not with a bare `npm i`: terminal `pi install npm:@comput/pi-telegram`. This installs user-wide resources; bot credentials and session assignments are still per project. Pi also supports project installation with `pi install npm:@comput/pi-telegram -l`; use the same scope for removal. Terminal `pi list` shows installed sources, and `pi config` enables/disables resources (`pi config -l` starts with project overrides). Review trust prompts instead of bypassing them. Official [Pi package documentation](https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/docs/packages.md) explains pinned/local/Git sources.

## BotFather setup and recovery

The recommended path is **Local Pi** `/telegram-start` → **Add a bot…** → **Add BotFather bot** (or `/telegram-setup-bot`). Create a bot with Telegram's verified **@BotFather** using `/newbot`, then enter its exact username and token only in Pi's local UI. Token input is masked and checked against Telegram. Never send a bot token to the model or paste it into this chat.

If the bot already has a webhook, Pi asks before removing it for local polling. That would affect its existing integration: decline unless you intend to move it. Startup never silently deletes webhooks.

Open the new bot's private Telegram chat, press **Start**, then send the exact one-time pairing code displayed by Pi. The pairing window expires after three minutes; Escape in local Pi cancels it. Pairing instructions wrap on narrow terminals while retaining every character. If a display still clips the code, widen the terminal or cancel and retry—do not guess the code.

A regular BotFather bot can be restored after reinstall by adding its username/token again. Re-adding an already paired project bot preserves its stored owner. Changing owners requires explicitly removing the local entry and pairing again; do not edit the owner field manually.

## Sessions, transfers and safe recovery

A project can hold multiple bots, but each persistent Pi session has at most one assigned bot and each bot entry has one session assignment. **Local Pi** `/session` shows the persistent session ID; `/name` can give it a recognizable display name. Resume that session from the same project using **terminal** `pi -r`, `pi -c` for the most recent session, or `pi --session <id>`. Inside Pi, `/resume` opens the session picker. Avoid `--no-session` for a setup you want to resume.

`/new`, `/fork` and `/clone` create different sessions; they do not inherit the old bot assignment. Use `/telegram-start` if you deliberately want to select/transfer a bot. Transfers require local confirmation; setup stops if the confirmed configuration changed during a dialog. The old process checks ownership and stops polling after a transfer. Failed transfers restore the old assignment only when it has not since changed.

One host-local lease protects polling/pairing. Release the old integration before moving the same bot between projects or machines; there is no cross-machine coordination service. On a polling conflict, identify and release/close the previous Pi process first. Abandoned locks become recoverable after two minutes without heartbeat. **Never delete live locks or run multiple polling clients to force recovery.** Release or reload older PID-lock implementations before migration.

## Commands

| Local Pi command | Purpose |
|---|---|
| `/telegram-start` | Select, add or transfer a bot for this session |
| `/telegram-status` | Inspect this session's assignment/connection |
| `/telegram-release` | Disconnect/unassign this session; preserve credentials |
| `/telegram-remove-bot` | Select and remove local project credentials; not Telegram revocation |
| `/telegram-setup-bot` | Add a BotFather bot |
| `/telegram-setup` | Choose manual or advanced manager mode |
| `/telegram-setup-manager` | Configure an advanced manager bot |
| `/telegram-complete-setup` | Complete this session's pending managed creation |
| `/telegram-cancel-managed-bot` | Cancel a pending managed creation request |

| Telegram input | Behavior |
|---|---|
| Normal text | Starts a turn when idle; steers recognized Telegram-originated work while busy |
| `!text` / `!!text` | Literal text, not shell controls |
| `/steer text` | Explicit steering, subject to the same origin guard |
| `/status` | Project, branch when available, host/IP and controls |
| `stop` / `/stop` | Requests cancellation of eligible Telegram-originated work; not proof all workers stopped |
| `/reload` | Requests Pi reload while idle |
| `/help` | Lists Telegram controls |

Replies are sent through explicit extension tools, not automatic forwarding of console text. Use `telegram_post` for replies/buttons, `telegram_draft` for previews and finalization, `telegram_edit` for returned message references, and `telegram_activity` for separate Working/clear control. The removed 0.5.0 `telegram_send` API has no compatibility adapter; see [migration](agent-tools.md#migration-from-050). Button selections and attachments are authenticated follow-ups, not steering commands or automatic approval.

## Files and privacy

For a requested outgoing project file, the agent can use `telegram_send_file` (up to 50 MB). `telegram_send_photo` sends inline PNG/JPEG (up to 10 MB, width+height at most 10,000, aspect ratio at most 20:1). Captions are at most 1,024 characters. Photos may be resized/compressed; ask for document delivery for original bytes. There is no automatic format conversion or metadata removal.

The paired owner may upload documents/photos privately. Captions become follow-up instructions, not Telegram commands. Without a caption the agent should ask what you want before inspection. Downloads are limited to 20 MB each and 100 files/100 MB total inbox storage, saved under `.pi/telegram-inbox/`; files stay until removed locally. Partial downloads are cleaned up. Only one download runs at a time; honor resend notices during it. Ordinary text and `/steer` remain admissible during downloads, subject to console-task protection; additional attachments and question-button selections require retry after the download.

Paths stay inside the project, with credential/repository-internal and symlink/tracked-path safeguards. These checks are **not** secret-content or malware scans. Files are untrusted data, never automatically executed/extracted. Bot chats are not end-to-end encrypted. Telegram receives explicitly sent replies and attachments; connection/status notices disclose project/host information. Review uploads yourself before requesting them.

## Updates and removal

For the usual unpinned npm install, use **terminal** `pi update npm:@comput/pi-telegram`, then **Local Pi** `/reload` in each session that should use the new package. Plain `pi update` updates Pi itself, not this package. Pinned versions are not advanced by ordinary package updates; deliberately select a new version with `pi install npm:@comput/pi-telegram@<version>` instead. Local/Git/custom-manager installations require their own reviewed update path.

Startup checks npm in the background with an eight-second timeout; failure does not prevent connection. `PI_OFFLINE` suppresses that check. Eligible standard npm installs may offer owner-only **Update / Not now** buttons; approval applies to the offered version and only the approving idle session reloads. Other sessions are not restarted. These flows have mocked coverage, not complete live install verification. Failed/uncertain installs are not automatically retried or rolled back.

Choose the operation you actually want:

| Goal | Action | What remains |
|---|---|---|
| Disconnect this session | Local Pi `/telegram-release` | Project credentials, Telegram bot and token |
| Forget a project bot | Local Pi `/telegram-remove-bot`, confirm selection | Telegram bot/token remain valid at Telegram |
| Disable loading | Terminal `pi config`, then local reload/restart | Installation and credentials remain |
| Uninstall this extension | Terminal `pi remove npm:@comput/pi-telegram` (add `-l` for local scope), then local reload/restart | Stored credentials/session files and Telegram bot may remain |
| Revoke a leaked token or delete a bot | Use verified @BotFather / Telegram's controls | Local entries do not update automatically; reconnect/re-pair deliberately |

Release/remove credentials **before** uninstalling if that is your intent. Package removal does not revoke a token or erase private settings. Never delete credential files wholesale as routine troubleshooting.

## Advanced: manager-created bots

Most users should use BotFather. Manager mode additionally requires a manager bot whose verified Telegram identity has `can_manage_bots: true`. **Local Pi** `/telegram-setup-manager` collects its username and masked token; ordinary bots cannot substitute for a capable manager.

Choose **Add a bot… → Create managed bot**, provide the exact child username, approve Telegram's creation link, and press **Start** in Telegram. Tell the initiating agent “done,” or use **Local Pi** `/telegram-complete-setup`. This checks the existing creation update; do not repeatedly create new requests while waiting. Local confirmations are still required for transfer/webhook changes. Escape cancels the local step; `/telegram-cancel-managed-bot` cancels pending creation.

Pending creation belongs to its initiating project and persistent session. Resume that session to complete it; legacy recovery requires explicit local confirmation. A best-effort catalog records managed bot IDs/usernames/owners, not child tokens. Telegram provides no general list-managed-bots or arbitrary private username lookup. Recovery requires a known identity/numeric ID or credentials; never guess a bot ID or derived username.

## Private configuration locations

- Project bots/assignments and plaintext tokens: `<project>/.pi/pi-telegram.local.json`.
- Advanced manager settings: `~/.pi/agent/pi-telegram/settings.json` (overridable by `PI_TELEGRAM_SETTINGS`).

Use the UI rather than editing assignments. Writes reject tracked/symbolic credential paths and add local Git exclusions; permissions are not encryption or a Windows ACL guarantee. Protect backups and do not commit or share these files. Existing version-1 project settings migrate to version2 at the next mutation. There is no hosted provisioner, cloud registry or global cross-machine bot binding.
