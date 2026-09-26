# Pi Telegram

Use your private Telegram bot to talk to a running [Pi coding-agent](https://pi.dev/) session. Setup happens in your local terminal; afterward you can send requests and receive replies in Telegram.

**Documentation for 0.6.0.** Upgrading from 0.5.0? The generic `telegram_send` tool is replaced by explicit Post/Draft/Edit/Activity operations, with separate draft and Working lifecycles. Read the [migration guide](docs/agent-tools.md#migration-from-050). Thinking and the optional usage skill are described in the [agent/tool guide](docs/agent-tools.md).

## 1. Before you start

- A working interactive Pi installation and model/provider login. First get a harmless reply in Pi itself; use **Local Pi** `/login` and `/model` if needed. See [Pi's quick start](https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/docs/quickstart.md).
- Node meeting your installed Pi's requirements (the examined current Pi requires **22.19.0 or later**), npm, and network access to your model provider and Telegram. The extension's own lower Node floor is not a Pi compatibility guarantee.
- A Telegram account and a bot you control. Start with a regular **BotFather bot**; manager-created bots are an advanced option.
- A project folder you trust. Pi can read files and run commands there. **Keep the Pi terminal/process running**; this package is not a hosted bot service.

Commands below are labeled **Terminal**, **Local Pi** or **Telegram** so you know where to type them.

## 2. Install

In a **Terminal**:

```bash
pi install npm:@comput/pi-telegram
cd /path/to/your/project
pi
```

Use Pi's package installer, not bare `npm i`. If Pi was already running, use **Local Pi** `/reload` to load the installed extension. Review any project-trust prompt; do not blindly approve unknown projects. Installation alone does not create a bot or assign it to a session.

## 3. Connect your bot

1. In **Telegram**, open verified **@BotFather**, send `/newbot`, and follow its instructions.
2. In **Local Pi**, run `/telegram-start` → **Add a bot…** → **Add BotFather bot**.
3. Enter the bot's exact username and token in Pi's local setup UI. **Never paste the token into an agent conversation, Telegram chat or issue.** Token entry is masked.
4. If asked about an existing webhook or session transfer, confirm only if you intend to take over that integration.
5. Open **your bot's private Telegram chat**, press **Start**, then send the exact one-time pairing code shown in Pi. It expires after three minutes; Escape cancels local pairing.
6. Wait for the Connected notice. Use **Local Pi** `/telegram-status` if you are unsure.

## 4. Try a harmless request

In **Telegram**, send:

> Reply here with “Connection works.” Do not read files, change anything or run commands.

A connection notice is not proof that a model reply works. If no answer arrives, check Pi locally for provider/login errors. Replies require the agent to use Telegram's explicit reply tools; ordinary terminal text is not automatically forwarded.

## 5. Continue later

Each bot is assigned to **one persistent Pi session**, not every session in a folder. Keep Pi running for Telegram to work. After closing it, return to the same project and resume:

```bash
# Terminal: choose the original session
pi -r
# Or continue the most recent session in this project
pi -c
```

**Local Pi** `/session` shows its ID; **Terminal** `pi --session <id>` opens that exact session. Resuming reconnects its assigned bot. Starting `/new` or forking creates a different session; it does not inherit the assignment. Use `/telegram-start` only if you deliberately want to select or transfer a bot. Avoid `--no-session` for a setup you want to resume.

## Troubleshooting

| Symptom | Safe next step |
|---|---|
| `/telegram-start` is missing | **Terminal:** check `pi list` and `pi config`; enable this package in the correct scope. **Local Pi:** `/reload`. |
| Connected, but no answer | Confirm a working model/provider in local Pi and inspect its errors. Ask for a brief Telegram reply; do not share tokens or private logs. |
| Bot is silent after restarting Pi | Resume the original session in the same project; inspect local `/telegram-status`. A new session is intentionally unassigned. |
| Pairing code is clipped or expired | Widen the terminal, or Escape and restart pairing. Send the new exact code to your bot, not BotFather; never guess it. |
| Webhook / `409 Conflict` / bot already polling | Release or close the previous integration intentionally. Do not start competing pollers or remove live lock files. |
| Telegram text arrives during unrelated console work | Unreleased source accepts ordinary text and `/steer` as a follow-up turn after that work, without interrupting it or sending a queued acknowledgement. Published 0.6.0 instead refuses and asks you to resend. |
| Stop did not stop every worker | Telegram Stop is request-bound and host cancellation is not a worker-termination guarantee. Inspect/control the work locally; do not infer cancellation from UI cleanup. |
| File rejected | Check the documented size/path limits. Credential/repository-internal files are blocked; do not bypass those safeguards. |

More help: [user guide: commands, recovery, files and advanced setup](docs/user-guide.md).

## Update, disconnect or remove

- **Update package — Terminal:** `pi update npm:@comput/pi-telegram`, then **Local Pi:** `/reload`. Plain `pi update` updates Pi itself. Pinned/local/Git installs need their own [update path](docs/user-guide.md#updates-and-removal).
- **Disconnect this session — Local Pi:** `/telegram-release`. Keeps credentials for later selection.
- **Forget a project bot — Local Pi:** `/telegram-remove-bot`. Deletes selected local credentials, **not** the Telegram bot or its token at Telegram.
- **Uninstall extension — Terminal:** `pi remove npm:@comput/pi-telegram`, then reload/restart Pi. Add `-l` only if installed project-locally. This does not erase credentials or revoke tokens; release/remove them first if desired.
- **Revoke a token/delete a bot — Telegram:** use verified @BotFather's controls. This is separate from local disconnection/removal.

## Security and more information

Pi packages have full system access. Only the paired owner's private messages are accepted, but Telegram bot chats are **not end-to-end encrypted**. Stored tokens are plaintext: protect local settings and backups, never commit them. Connection/status notices disclose project/host details. Attachment safeguards check paths, not arbitrary file contents for secrets or malware.

- [User guide](docs/user-guide.md): published commands, session transfers, files, manager mode and private settings.
- [Agent/tool guide](docs/agent-tools.md): explicit 0.6.0 API, optional skill and Thinking lifecycle.
- [Development status](docs/development-status.md): exact source-test observations, known limits and contributor checks; no blanket platform/compatibility claim.
- [Changelog](CHANGELOG.md) · [Security reporting](https://github.com/comput-sh/pi-telegram/blob/main/SECURITY.md) · [MIT license](LICENSE)
