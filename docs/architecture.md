# Architecture

## Product boundary

Pi Telegram Extension is a local Pi package. It talks directly to the Telegram Bot API and has no hosted provisioner, cloud registry, webhook, Azure resource, or shared service credential.

A skill is optional and must never own credentials, provisioning state, authorization, or transport.

## Configuration model

### Global settings

```text
~/.pi/agent/pi-telegram-extension/settings.json
```

The first interactive run records one provisioning mode:

- `manager` — includes the Telegram-verified manager bot ID, username, token, and managed-update offset.
- `manual` — records the user's decision not to configure a manager bot.

Declining manager mode is persistent. The extension does not ask again unless the user runs `/telegram-setup` or `/telegram-setup-manager`.

### Private project settings

```text
<project>/.pi/pi-telegram-extension.local.json
```

This file contains the project bot's Telegram-provided ID and canonical username, token, authorized owner ID, and managed/manual origin. It applies across Pi sessions in the project but is never stored in Pi transcript/session data.

The extension writes private files with restrictive permissions where the platform supports them. In Git repositories, it adds the project settings path to `.git/info/exclude`. There is intentionally no tracked project binding.

## Manual-bot flow

```text
First run or /telegram-setup-bot
  -> prompt locally for exact username
  -> prompt locally for token with hidden input
  -> call getMe and verify the canonical username
  -> generate a one-time pairing code
  -> user opens the bot, presses Start, and sends the exact code
  -> extension accepts only the matching private human sender
  -> save bot ID, canonical username, token, and owner ID in project settings
  -> connect the live Pi session
```

Tokens never enter model prompts, tool arguments, chat messages, or command parameters.

## Managed-bot flow

```text
First global run
  -> user confirms that a manager bot exists
  -> local hidden token prompt
  -> getMe verifies identity and can_manage_bots
  -> manager credentials are saved in global settings

User explicitly asks to enable Telegram
  -> telegram_enable requires the exact user-chosen bot username
  -> extension checks queued managed_bot updates locally
  -> if absent, return t.me/newbot/<manager>/<chosen-username> approval URL

User approves creation and invokes telegram_enable again
  -> extension receives the matching managed_bot update
  -> getManagedBotToken obtains the child token
  -> child getMe verifies ID and canonical username
  -> setManagedBotAccessSettings restricts access
  -> owner comes from ManagedBotUpdated.user
  -> save private project settings and connect
```

No username is derived from the project name. There are no prefixes, hashes, truncation rules, suggestions, or project keys.

## Runtime flow

- One Pi session owns one Telegram `getUpdates` connection.
- A project with valid private settings connects on interactive session startup.
- After connecting, the owner receives a startup summary with project name, Git branch when available, hostname/IP, and concise controls.
- Session shutdown aborts and awaits polling.
- Ordinary Telegram input uses `deliverAs: "followUp"`. A leading `!` selects `deliverAs: "steer"`; `!!` escapes a literal leading bang.
- Output returns to Telegram only for Telegram-originated requests.
- A native Rich Thinking/tool draft appears immediately. Public commentary replaces it with one evolving plain progress line, and final-answer text continues in that draft.
- Completed responses are persisted with `sendRichMessage`.
- `/help`, `/status`, `/steer`, `/stop`, and `/reload` bypass the model.
- `telegram_send_file` can upload safe project artifacts as native documents.
- Hidden reasoning, prompts, raw tool arguments/results, and credentials are never delivered.

Concurrent Pi sessions using the same project bot are unsupported and fail clearly rather than silently competing for `getUpdates`.

## Security boundary

- Manager credentials exist only in global private settings and process memory.
- Child credentials exist only in private project settings and process memory.
- Manually provisioned bots are paired through an exact one-time code before an owner ID is trusted.
- Managed-bot owner identity comes from Telegram's `ManagedBotUpdated.user` and child identity is revalidated with `getMe`.
- Managed bots are configured with restricted access.
- Setup deletes any existing webhook before local long polling; a bot cannot simultaneously use a webhook elsewhere.
- Credential-bearing Bot API URLs are never included in errors.

## References

- [Telegram Managed Bots](https://core.telegram.org/api/bots/managed-bots)
- [Telegram Bot API](https://core.telegram.org/bots/api)
