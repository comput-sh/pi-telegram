# Pi Telegram Agent Guide

## Product direction

Make Telegram a first-class frontend for live Pi coding-agent sessions. Prefer native Telegram drafts, Rich Messages, commands, documents, media, and controls when they improve the experience. Native Thinking is a generic status placeholder, never a channel for hidden reasoning.

## Boundaries

- Keep transport, authorization, lifecycle, polling, and credentials in package code.
- Pi Telegram talks directly to the Telegram Bot API; do not introduce a hosted provisioner or cloud registry.
- Store manager mode and manager credentials globally in `~/.pi/agent/pi-telegram/settings.json`.
- Store each project bot in `.pi/pi-telegram.local.json`, outside Pi session/transcript data.
- Never derive, suggest, hash, or truncate bot usernames from project names. Managed usernames are explicit user choices; existing identities come from `getMe`.
- Tokens must be collected through hidden local UI, never through model tool parameters or chat.
- One Pi session owns one project-bot `getUpdates` connection.
- Serialize manager polling with the global lock and one persisted pending username.
- Save a managed child connection before advancing the manager update offset.
- Reject tracked or symbolic project credential paths and exclude the path from Git before writing.
- Confirm explicitly before deleting any existing Telegram webhook.
- Accept only private messages from the stored owner.
- Send Telegram output only for Telegram-originated requests.
- Never expose hidden reasoning, prompts, raw tool arguments/results, or credentials.
- Never commit bot tokens, local settings, private keys, or environment files.

## Layout

- `src/` — TypeScript Pi package.
- `tests/` — automated tests.
- `docs/` — architecture and Telegram UX findings.

## Validation

```bash
npm run validate
```

After changing an installed local package, run `/reload` in Pi.
