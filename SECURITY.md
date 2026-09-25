# Security Policy

## Reporting a vulnerability

Please do not open a public issue for credential exposure, authorization bypasses, token leakage, or other security-sensitive findings. Use GitHub's **Report a vulnerability** option on the repository's Security tab if available. Otherwise, use a private contact method listed by the maintainer at <https://github.com/comput-sh>. If neither is available, request a private reporting channel without posting sensitive details.

Include the affected version, impact, and minimal reproduction details. Do not include live Telegram bot tokens or owner identifiers.

## Scope and trust model

This policy describes the current 0.2.1 source; check the installed version before assuming these safeguards exist in older npm releases. Automated validation is not a completed independent security audit or live multi-session smoke test.

Pi packages execute with the user's system permissions. The paired Telegram owner can ask the coding agent to perform actions with those permissions; owner-only transport does not sandbox the agent or replace Pi's approval policies. Other extensions, local processes with access to the same account, and anyone who obtains a bot token are outside the transport's isolation boundary.

Telegram bot chats are not end-to-end encrypted. Public answers, requested documents, and startup metadata (project and IP address) and status metadata (additionally branch when available and hostname) are sent through Telegram. Choose tasks and artifacts accordingly.

## Credential handling

- Never commit `.pi/pi-telegram.local.json`, global Pi Telegram settings, bot tokens, private keys, or environment files.
- Global manager credentials are stored in `~/.pi/agent/pi-telegram/settings.json`, or the path selected by `PI_TELEGRAM_SETTINGS`.
- Project bot credentials are stored in `<project>/.pi/pi-telegram.local.json`.
- Tokens are entered only through masked local terminal UI and must never be sent through chat or model-callable tool arguments. Masking protects display, not storage.
- Settings contain plaintext credentials. Restrictive file modes are requested where supported, but are not encryption and do not establish Windows ACL protection. Secure the account, filesystem, backups, and synchronized folders appropriately.
- The global managed-bot catalog contains child identities and owner IDs, but no child tokens. Treat this metadata as private too.
- Rotate any credential that has entered logs, chat transcripts, Git history, or package archives.
- Configuring a bot for local polling removes its existing Telegram webhook only after explicit confirmation.
- Global and project credential writes reject symbolic paths and files already tracked by Git, and exclude untracked credential files locally before writing.
- Manager polling is serialized with a private lock and one persisted pending request.
- Project mutations are serialized; transfers, removal, and rollback check the confirmed snapshot under the lock. Releases verify the current persistent session assignment.
- Host-local heartbeat leases protect both normal polling and owner pairing; lost ownership causes disconnection. They are not a cross-machine lock or a distributed bot registry. Do not run competing integrations on different hosts.
- One-use in-memory request receipts establish inbound provenance and prevent stale requests from silently redirecting to replacement bots. A copied transport prefix is not authentication. Agent text is never automatically forwarded; explicit `telegram_send` calls may proactively send without a Telegram-originated request, only through this session's ready, verified assignment. File/photo tools remain request-bound.
- Temporary credential files are excluded before writing and blocked from attachments, as are the actual configured global settings path and its temporary siblings.
- Attachments are revalidated and checked against the opened file's identity before upload. Filename checks are defense in depth, not a general-purpose secret scanner for arbitrary documents or archives.

## Revocation and incident response

- Releasing a session preserves local credentials. Removing a bot deletes its local project entry but does not revoke the token at Telegram, remove other copies/backups, or remove its identity from the manager catalog.
- If a token is exposed, revoke/rotate it through Telegram's supported bot-management interface and update affected installations through local setup. Deleting a file or Git commit alone does not invalidate a leaked token.
- For npm authentication, prefer the GitHub Actions Trusted Publishing workflow. Never paste npm tokens into issues, chat, workflow files, or release notes. Trusted Publishing was verified for 0.2.0; local npm tokens are not required for the release workflow. Review and revoke obsolete publishing credentials through secure account UI.
