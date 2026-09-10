# Security Policy

## Reporting a vulnerability

Please do not open a public issue for credential exposure, authorization bypasses, token leakage, or other security-sensitive findings. Contact the maintainer through the private contact options on the GitHub profile at <https://github.com/mbundgaard>.

Include the affected version, impact, and minimal reproduction details. Do not include live Telegram bot tokens, Azure Function keys, storage connection strings, or owner identifiers.

## Credential handling

- Never commit `telegrampi.json`, Function settings, bot tokens, private keys, or environment files.
- Keep extension configuration in `~/.pi/agent/telegrampi.json` or environment variables.
- Treat the provisioner Function key as an administrative client credential.
- Rotate any credential that has entered logs, chat transcripts, Git history, or package archives.
