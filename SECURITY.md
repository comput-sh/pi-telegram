# Security Policy

## Reporting a vulnerability

Please do not open a public issue for credential exposure, authorization bypasses, token leakage, or other security-sensitive findings. Contact the maintainer through the private contact options on the GitHub profile at <https://github.com/mbundgaard>.

Include the affected version, impact, and minimal reproduction details. Do not include live Telegram bot tokens or owner identifiers.

## Credential handling

- Never commit `.pi/pi-telegram.local.json`, global Pi Telegram settings, bot tokens, private keys, or environment files.
- Global manager credentials are stored in `~/.pi/agent/pi-telegram/settings.json`.
- Project bot credentials are stored in `<project>/.pi/pi-telegram.local.json`.
- Tokens are entered only through hidden local UI and must never be sent through chat or model-callable tool arguments.
- Rotate any credential that has entered logs, chat transcripts, Git history, or package archives.
- Configuring a bot for local polling removes its existing Telegram webhook only after explicit confirmation.
- Global and project credential writes reject symbolic paths and files already tracked by Git, and exclude untracked credential files locally before writing.
- Manager polling is serialized with a private lock and one persisted pending request.
- Project mutations are serialized; transfers, removal, and rollback check the confirmed snapshot under the lock. Releases verify the current persistent session assignment.
- Heartbeat leases protect both normal polling and owner pairing; lost ownership causes disconnection.
- One-use in-memory request receipts bind responses to the receiving connection. A copied transport prefix cannot authorize output.
- Temporary credential files are excluded before writing and blocked from attachments, as are the actual configured global settings path and its temporary siblings.
- Attachments are revalidated and checked against the opened file's identity before upload. Filename checks are defense in depth, not a general-purpose secret scanner for arbitrary documents or archives.
