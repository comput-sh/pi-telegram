# Pi Telegram

**Your Pi session, wherever you are.**

Step away from your terminal without leaving your coding session behind. Pi Telegram connects a running [Pi coding agent](https://pi.dev/) to your private Telegram bot, so you can send requests, ask follow-up questions and receive replies and files from your phone.

Same session. Same project context. Another way to work with Pi.

## What you can do

- **Keep the conversation going.** Ask about your project or give the agent its next task without returning to your desk.
- **Send context from your phone.** Share a screenshot or document with instructions for the agent.
- **Get useful answers back.** Receive formatted replies, code, files and images—not just a notification telling you to check the terminal.
- **Make choices in chat.** The agent can offer buttons for questions and next steps.
- **See progress when it matters.** Explicit progress messages, temporary answer previews and a Working indicator help the agent keep you informed.
- **Return to the same session.** Resume your persistent Pi session locally and its assigned bot reconnects.

For example:

> Explain how authentication works in this project. Don't change anything yet.

> Here's a screenshot of the bug. Help me work out what's wrong.

> Send me the report we just generated.

Pi Telegram is a **frontend for a Pi session**, not a hosted agent or a replacement for Pi's terminal interface. Your Pi process must stay running. Agent replies and progress use explicit Telegram tools; terminal conversations and tool output are not automatically mirrored into chat.

## Get connected

You'll need a working Pi installation with a configured model/provider, Node compatible with your Pi version, and a Telegram account. Start in a project you trust: the agent retains its normal ability to read files and run commands.

### 1. Install

In your **terminal**:

```bash
pi install npm:@comput/pi-telegram
cd /path/to/your/project
pi
```

Already running Pi? Use `/reload` in **local Pi** after installation.

### 2. Add your bot

1. In **Telegram**, open verified **@BotFather**, send `/newbot`, and follow its instructions.
2. In **local Pi**, run `/telegram-start` → **Add a bot…** → **Add BotFather bot**.
3. Enter the bot's exact username and token in the local setup UI. Token entry is masked. **Never paste the token into an agent conversation, Telegram chat or issue.**
4. Open **your bot's private Telegram chat**, press **Start**, and send the exact one-time pairing code shown in Pi. The code expires after three minutes.
5. Wait for the Connected notice.

If setup asks to remove a webhook or transfer a bot from another session, confirm only if you intend to take over that connection.

### 3. Say hello

Send this to **your bot in Telegram**:

> Reply here with “Connection works.” Do not read files, change anything or run commands.

You’re ready when the agent replies. If it doesn't, check local Pi for model/provider errors and run `/telegram-status`. See the [setup and recovery guide](docs/user-guide.md#botfather-setup-and-recovery) for help.

## Pick up where you left off

A bot belongs to **one persistent Pi session**, not every session in a project folder. After closing Pi, return to the project and resume the original session:

```bash
pi -r
```

Or use `pi -c` to continue the most recent session in that project. Its assigned bot reconnects when the session resumes.

A new or forked session does not inherit the bot. Use `/telegram-start` to deliberately select or transfer one. More on [sessions and transfers](docs/user-guide.md#sessions-transfers-and-safe-recovery).

## A few useful controls

| Where | Command | Purpose |
|---|---|---|
| Local Pi | `/telegram-status` | Check the connection and assignment |
| Local Pi | `/telegram-release` | Disconnect this session, keeping bot credentials |
| Local Pi | `/telegram-remove-bot` | Remove a bot's local project credentials |
| Terminal | `pi update npm:@comput/pi-telegram` | Update the package; then `/reload` in local Pi |

Removing local credentials does not delete the bot or revoke its token at Telegram. See the [full command guide](docs/user-guide.md#commands) and [update/removal instructions](docs/user-guide.md#updates-and-removal).

## Private by design, with clear boundaries

- Only the paired owner's private messages are accepted.
- Pairing requires a short-lived code shown in your local Pi setup.
- Agent content is sent explicitly, rather than automatically forwarding terminal output or private reasoning.
- File delivery is restricted to allowed project files, with credential and repository-internal paths blocked. These checks do not scan arbitrary file contents for secrets or malware.

**Telegram bot chats are not end-to-end encrypted.** Pi extensions have full system access, stored tokens are plaintext, and connection/status notices include project/host details. Protect your local settings and backups, and use a bot only with projects and information you're comfortable accessing through Telegram.

Stop is request-bound; it is not a guarantee that every worker or subprocess has terminated. Check ongoing work locally when necessary.

## Learn more

- [User guide](docs/user-guide.md) — commands, files, recovery, session transfers and advanced setup.
- [Agent/tool guide](docs/agent-tools.md) — explicit messaging, previews, progress and the optional usage skill.
- [Upgrading from 0.5.0](docs/agent-tools.md#migration-from-050) — migration to the explicit Post/Draft/Edit/Activity tools.
- [Changelog](CHANGELOG.md) — release notes, including pending changes.
- [Development status](docs/development-status.md) — validation evidence and known limitations.
- [Security reporting](https://github.com/comput-sh/pi-telegram/blob/main/SECURITY.md) · [MIT license](LICENSE)

The public release baseline for this guide is **0.6.0**. The prepared **0.6.1** release adds follow-up queuing during unrelated console work and native feedback; publication is pending. In 0.6.0, messages sent during unrelated console work receive a refusal asking you to resend when it finishes.
