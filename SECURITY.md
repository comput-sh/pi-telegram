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
- Configuring a bot for local polling removes its existing Telegram webhook.
