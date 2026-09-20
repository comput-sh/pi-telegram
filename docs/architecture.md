# Architecture

## Product boundary

Pi Telegram is a globally installed local Pi package. It talks directly to the Telegram Bot API and has no hosted provisioner, cloud registry, webhook receiver, Azure resource, deterministic project key, or shared service credential.

Loading globally does not imply activation. Startup performs only a local project-settings read. It contacts Telegram only when one configured bot is assigned to the current persistent Pi session ID.

## Configuration model

### Global settings

```text
~/.pi/agent/pi-telegram/settings.json
```

Global settings contain either:

- `manager` mode with the Telegram-verified manager ID, username, token, managed-update offset, one pending request, and a best-effort known-bot catalog; or
- `manual` mode without bot credentials.

The known-bot catalog stores only managed bot IDs, usernames, owner IDs, and observation times. Child tokens remain project-local. The catalog is recovery metadata, not an authoritative registry: Telegram exposes neither `listManagedBots` nor arbitrary username-to-ID lookup, and `getManagedBotToken` requires a numeric child bot ID.

Global setup is explicit. `session_start` never prompts for provisioning mode.

### Private project settings

```text
<project>/.pi/pi-telegram.local.json
```

Version 2 stores a list of bot credentials and assignments:

```json
{
  "version": 2,
  "bots": [
    {
      "id": "987654321",
      "username": "ChosenBot",
      "token": "<secret>",
      "ownerUserId": "123456789",
      "managed": true,
      "sessionId": "persistent-pi-session-id"
    }
  ]
}
```

`sessionId` is either `ctx.sessionManager.getSessionId()` or `null`. Validation enforces unique bot IDs, unique usernames, and at most one bot per non-null session ID. A project can retain many unassigned bots. Legacy version-1 settings load as one unassigned bot and become version 2 on the next mutation.

Project configuration updates use a global per-project mutation lock and atomic private-file replacement. Confirmed assignments and rollback use compare-and-swap against the confirmed project snapshot. All manager writes share one global lock, including manual-mode changes and manager replacement. Heartbeat locks use `proper-lockfile`, renew every ten seconds, and become stale after two minutes without renewal; compromised settings locks reject subsequent writes. Before writing, Pi Telegram rejects symbolic credential paths and tracked settings paths, then excludes both the destination and its temporary-file pattern in `.git/info/exclude`.

## Explicit start flow

`/telegram-start` and the model-callable `telegram_start` open local selection UI. No token or owner data enters model history or tool arguments.

Pending managed creation records the canonical project path and persistent initiating session ID. `/telegram-complete-setup` and `telegram_complete_setup` check that existing request directly, without creation or selection menus. The agent may invoke completion when the user says “done” in setup context; no global text interceptor is used. `/telegram-start` puts matching pending completion first. Cross-project/session completion is rejected, and legacy unbound requests require explicit local recovery confirmation through Add → Complete. The pending snapshot is compared under the manager lock before mutations, so concurrent cancellation or replacement cannot be overwritten. Pairing/owner validation, webhook confirmation, and assignment transfer safeguards remain unchanged.

Possible actions are generated from current state:

1. Select an unassigned project bot.
2. Reconnect the bot already assigned to this persistent session.
3. Move a bot from another persistent session after explicit confirmation.
4. Import a managed bot from the manager's known-bot catalog.
5. Recover an existing managed bot from a known numeric ID and exact username, then establish its owner by private pairing after restricting access.
6. Complete the single pending managed-bot request.
7. Create a new managed bot with an exact user-chosen username.
8. Add a BotFather bot through masked local credential input and private owner pairing.
9. Configure or replace the manager.

The first menu lists configured bots and Add/Manage submenus. Recovery and manager administration live under Manage. Escape cancels every setup step, including display-name input and asynchronous owner pairing.

Assigning a bot also clears any different bot assignment held by the current session. A failed switch restores the prior snapshot and attempts to reconnect its bot only if no intervening mutation occurred. This maintains the one-session/one-bot invariant without silently undoing another user's decision.

`/telegram-release` and `telegram_release` verify that the assignment belongs to the current session, attempt a confirmation with a two-second timeout, stop polling, release runtime ownership, and set only that bot's `sessionId` to `null`. Failed confirmation delivery does not prevent local cleanup.

`/telegram-remove-bot` and `telegram_remove_bot` require a second local selection and destructive confirmation. They remove the selected assignment and locally stored child credentials but do not delete or revoke the Telegram bot. Removing a bot assigned to another live session causes that session's ownership monitor to disconnect.

## Manual-bot flow

```text
Explicit start or /telegram-setup-bot
  -> prompt locally for exact username
  -> prompt locally for token with hidden input
  -> getMe verifies ID and canonical username
  -> resolve existing project ownership and confirm any transfer
  -> acquire an exclusive runtime lease before any pairing poll
  -> user confirms any existing webhook takeover
  -> generate a one-time pairing code
  -> accept only the exact code from a private human sender
  -> store the owner ID returned by Telegram
  -> upsert and assign the bot to the current persistent Pi session
  -> connect
```

Username and BotFather token are sufficient for recovery because `getMe` returns the numeric child bot ID. Tokens never enter prompts, command arguments, chat messages, or model-callable tool parameters.

## Managed-bot flow

```text
Explicit manager setup
  -> masked local manager token input
  -> getMe verifies identity and can_manage_bots
  -> user confirms local polling/webhook takeover
  -> save manager credentials globally

Explicit managed-bot creation
  -> prompt locally for exact child username and display name
  -> acquire global manager lock
  -> persist one pending request
  -> consume only managed_bot updates
  -> update the best-effort known-bot catalog
  -> if absent, return Telegram's approval URL

Explicit continuation after approval
  -> consume the matching ManagedBotUpdated event
  -> getManagedBotToken using Telegram's numeric child ID
  -> child getMe verifies ID and username
  -> setManagedBotAccessSettings restricts access
  -> owner comes from ManagedBotUpdated.user
  -> save new child credentials unassigned before advancing manager offset
  -> clear pending request
  -> use the same confirmed assignment transaction as other setup flows
  -> connect
```

No username is derived, prefixed, hashed, truncated, or suggested from project identity.

## Startup and runtime ownership

On interactive `session_start`:

1. Read project settings if present.
2. Read `ctx.sessionManager.getSessionId()`.
3. Find the one bot whose `sessionId` matches exactly.
4. If no match exists, return with no prompt and no network request.
5. Acquire the bot's private global runtime lease.
6. Start one owner-only `getUpdates` connection.

The runtime lease is keyed by Telegram bot ID and records only process/session metadata, never credentials. It prevents duplicate local processes—including duplicate processes for the same resumed Pi session—from polling or pairing one bot. The locking library manages stale recovery and heartbeat renewal, not an unchecked PID read followed by unlink. Status can display the polling PID and session. Live legacy PID locks block upgrading processes until the old process releases or reloads.

A connected process checks its persisted assignment periodically. If another session confirms a transfer and changes `sessionId`, the old process notifies locally, stops polling, and releases its lease. The receiving process waits briefly for this handoff. Telegram's `409 Conflict` response remains a secondary safeguard.

Startup messages include the extension version captured at factory load, not a later disk version. A background npm latest check has an eight-second timeout and respects `PI_OFFLINE`. Unassigned sessions do not notify or connect Telegram. Recognized unpinned Pi npm installations can show owner-only Update/Not now inline buttons. Callback queries never enter the agent input path: private chat, owner, message ID and a one-use connection-local nonce must match. Approval queues a guarded internal command that waits for idle, installs the exact offered version under a host-local heartbeat lock, verifies the installed version, and reloads only that session. Local/Git/symlinked/pinned/custom-manager installations only receive update notices. npm failures are reported without raw logs; no automatic rollback or retry is attempted. Disconnect invalidates offers/approval and aborts pending update work.

Session shutdown aborts pending setup as well as polling, then releases the runtime lease. Pi emits shutdown/start for new, resume, fork, and reload; no redundant before-switch disconnect hook is needed. Persistent assignment remains, so resuming the same Pi session reconnects automatically. Startup refuses existing webhooks rather than removing them without a new explicit confirmation.

## Telegram transport

- Accept only private messages from the stored owner.
- Ordinary text uses `deliverAs: "steer"` while busy and `"followUp"` when idle. Leading `!` characters are preserved literally with no prefix parsing; `/steer` remains an explicit command. Buttons and attachments remain follow-ups; no queued acknowledgements.
- Deliver inbound messages using one-use in-memory receipts admitted through Pi's `input.source === "extension"`. The transport notice is guidance, not authentication.
- Bind each receipt to its receiving connection; retire queued receipts on disconnect/session replacement so old queued work cannot send to a new bot. No transcript replay or automatic response forwarding.
- `telegram_send` independently sends optional Rich Markdown, optional `working` status, and optional buttons. It requires the current session's ready, persisted assignment but not an inbound request. A stale active inbound request cannot redirect to a replacement connection.
- Reject Telegram steering into a local-console task, including automatic steering from ordinary busy text; ask the owner to resend when that task finishes.
- Track stop eligibility from inbound provenance, not visual status. Proactive sends do not grant permission to stop unrelated console work.
- Status is a separate removable Working message with a five-second heartbeat and 15-minute expiry, not a chat action or automatic draft. Agents explicitly set Working at work start and on updates while activity continues, refresh before expiry, and omit status when done or waiting for the user. Omission removes Working and finalizes any pending draft; no Idle is shown. Execution/worker activity does not automatically mirror status. Stop/disconnect clean it up best-effort.
- The concise inbound notice requests explicit replies, concise milestone progress during tools, and suitable Rich Markdown formatting. Detailed activity and draft protocols live in tool descriptions/guidelines. The notice never authenticates a request; one-use receipts do.
- Serialize explicit outbound calls, fence them to the connection, and report uncertain delivery without replay. Only explicit sends publish agent content; control/attachment notices remain extension-controlled.
- Keep hidden reasoning, prompts, raw tool arguments/results, and credentials private.
- Let `/help`, `/status`, `/stop`, and `/reload` bypass the model.
- Allow `telegram_send_file` only during a Telegram-originated request and only for safe project files.

## Security boundary

- Manager credentials exist only in global private settings and process memory.
- Child credentials exist only in private project settings and process memory.
- Manual owner identity is established by an exact one-time private pairing code.
- Managed owner identity comes from Telegram's `ManagedBotUpdated.user`.
- Managed child identity is revalidated with `getMe` and access is restricted.
- Webhook removal requires explicit confirmation before local long polling.
- Manager polling is globally serialized and crash-safe.
- Project mutations are serialized across Pi sessions.
- Credential-bearing Bot API URLs are never included in errors.

## Components and validation

- `index.ts`: Pi event, tool, and command registration.
- `connection-manager.ts`: connection lifetime, polling ownership, and monitoring.
- `setup-flow.ts`: menus, pairing/recovery workflows, and rollback orchestration.
- `assignment.ts`: compare-and-swap assignment transactions.
- `request-routing.ts`: inbound origin receipts, stale-request protection, and explicit-send destination selection (no public response mirroring).
- `locks.ts` / `runtime-lease.ts`: heartbeat-based exclusion.
- `setup.ts`: masked local input and cancellable pairing UI.

Mocked lifecycle tests cover passive startup, resume/fork, duplicate processes, transfer races, rollback, shutdown during setup, offline release, pairing contention, and response-source isolation. They do not replace real two-session Telegram smoke tests.

## References

- [Telegram Managed Bots](https://core.telegram.org/api/bots/managed-bots)
- [Telegram Bot API](https://core.telegram.org/bots/api)
