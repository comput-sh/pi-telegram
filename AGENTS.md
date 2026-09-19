# Pi Telegram Agent Guide

## Project identity and product direction

Pi Telegram is a globally loaded TypeScript package that makes Telegram a native frontend for live Pi coding-agent sessions. It talks directly to the Telegram Bot API. There is no hosted provisioner, cloud registry, Azure dependency, deterministic project key, or tracked bot binding in the current product.

- Repository: <https://github.com/mbundgaard/PiTelegram>
- npm package: `@comput/pi-telegram`
- Development checkout: `D:\Source\PiTelegram`
- Canonical product name: **Pi Telegram**.

Prefer native Telegram drafts, Rich Messages, commands, documents, media, and controls when they improve the experience. Native Thinking is a generic status placeholder, never a channel for hidden reasoning. Keep model-facing usage guidance in the extension's tool descriptions, prompt guidelines, and transport notice, not exclusively in this development guide: consuming projects will not have this file.

## 0.4.0 release preparation — explicit draft streaming

- `telegram_send` message + Working without buttons now creates a temporary Rich Message draft. Full accumulated text extending the active draft's exact prefix updates that draft; different text persists the old draft and starts another. Matching never applies to already-persisted messages.
- Omitted status finalizes supplied text (or the pending draft for `{}`) and removes Working. Status-only Working retains the draft. Buttons always persist. Stop/disconnect/15-minute inactivity expiry discard pending state without publishing unfinished text; Telegram previews expire naturally.
- Tool description, prompt guidelines, inbound notice, README and changelog explain the full-snapshot protocol explicitly. No automatic assistant streaming. Local validation: 106 tests passed and typecheck passed; live rendering remains pending. User authorized publication as 0.4.0; registry verification is pending. Installation is not part of this publication. Host npm was previously updated and verified as 0.3.0, and explicit Telegram sends have succeeded live; full draft-streaming verification remains pending.

## Explicit asynchronous messaging (released in 0.3.0)

- `telegram_send` replaces `telegram_ask`: optional Rich Markdown `message`, optional `status: "working"`, optional label/reply `buttons` requiring a message. Omitted status removes Working; `{}` clears it. No Idle label. Tools return after delivery, never await a human answer.
- Explicit text/status sends can originate in console/scheduled work, but require this session's ready, verified assignment. Inbound provenance remains for steering, Stop, files and stale-connection protection. Queued receipts retired at disconnect must not route to replacement bots.
- Automatic assistant commentary/final streaming and tool/Thinking lifecycle mirroring are removed. Working uses a separate removable message with heartbeat and 15-minute expiry. Stop/disconnect cleanup is best-effort; command/queue/update/attachment notices remain automatic.
- File/photo safeguards remain request-bound. User authorized 0.3.0 publication. Release validation: 102 tests passed, typecheck/pack/diff checks passed, zero audit vulnerabilities; 23 intended package files. Publication is verified below; live activation remains pending. Installed npm remains 0.2.5 until explicitly updated.

## Connection-notice fix included in 0.3.0

- Startup sends the required Connected notice before optional menu configuration, with no startup Git-branch lookup. Menus run as bounded connection-bound background work; failure warns locally without disconnecting a healthy session.
- Existing initializing connections are not reported ready until the notice is accepted. Notice failure still tears down the connection for startup recovery.
- Regression coverage in `tests/connection-notice.test.ts`; investigation recorded in `docs/reload-notice-investigation.md`. Installed npm remains unchanged; live reload testing is pending. Included in the authorized 0.3.0 release.

## Reliability/streaming fixes (released in 0.2.5)

- Checkpoint `87ee97b` records reconnect recovery before streaming changes; both are included in 0.2.5. Startup retries assigned-session failures with bounded attempts/backoff and treats connection-notice failure as a failed connection. Retries stop on shutdown and recheck assignment.
- Subsequent streaming changes remove the phase-metadata gate: authenticated public text streams on text deltas, retaining multiline formatting and replacing the current preview. Thinking/tool data stays private. First public text writes immediately, later writes remain coalesced; generic status remains during tools/pauses.
- Validation: 98 tests passed. Live reload/update and streaming verification remain pending. The npm installation on this host was updated and verified as 0.2.5. Reload is still required to activate it; live reconnect/streaming testing is not yet verified.

## Question buttons (released in 0.2.4)

- Added `telegram_ask`: Rich Markdown question with 1–8 label/reply options, request-bound delivery, owner/chat/message/nonce validation and one-use callbacks routed as ordinary authenticated follow-ups.
- One pending question per connection; 15-minute expiry, replacement, typed answer, stop and disconnect invalidate it. Keyboard removal is best-effort. No approval is implied by tool success; no local confirmation bypass.
- Pre-release hardening rejects duplicate labels, fences slow sends against typed-answer/disconnect races, binds expiry timers to their question, and reports uncertain callback delivery without automatic replay or raw errors. Validation: 94 tests passed.
- Reload and live Telegram question/button smoke testing remain pending. Published in 0.2.4 with live testing still pending.

## Incoming files (0.2.3)

- Paired owners can send private documents/photos with optional captions. Captions are follow-up instructions, never Telegram commands or steering. Captionless attachments ask the agent to request instructions before inspection.
- `src/incoming-files.ts` streams to `.pi/telegram-inbox/` with unique sanitized names, Git-ignore/tracked-path checks, symlink rejection, 20 MB file and 100 files/100 MB inbox limits, and partial-download cleanup. Files persist until manually removed; no automatic execution/extraction, secret scanning or malware scanning.
- Downloads are connection-bound, abort on stop/disconnect, and do not block polling. One reception per connection; extra attachments/ordinary text during transfer receive explicit resend notices. Live upload smoke testing remains pending.

## Working-status fixes (0.2.3)

- Request activity resumes after completed messages and on authenticated assistant starts until `agent_settled`; parallel tools are tracked by call ID.
- Plain progress retains a visible generic activity label and changing heartbeat. Busy follow-ups receive a Queued acknowledgement without replacing active drafts.
- Regression tests added; live Telegram verification remains pending; the user authorized the 0.2.3 release with that limitation. `docs/working-status-investigation.md` records the prior behavior; its diagnostic artifact describes the pre-fix implementation.

## Update notifications (0.2.3)

- Startup includes the version captured when the extension factory loads. Background npm latest checks run on session startup/reload, with an eight-second timeout and PI_OFFLINE support; unassigned sessions stay silent.
- Owner-only native Update/Not now callback buttons use one-use connection-local nonces and exact message/chat validation. Approval queues an internal command, waits for idle, installs the exact offered version, then reloads only that session. Disconnect clears approval and aborts work.
- Only standard Pi npm prefixes are eligible; local/Git/symlinked/pinned/custom-manager installations are notification-only. npm is invoked through Node and npm-cli.js (no shell interpolation), with host-local update locking and installed-version checks. No automatic rollback or retry; raw npm output is not sent to Telegram.
- Automated tests cover version checks, protected installations, callback ownership/replay, idle deferral, cancellation and failed installs. Reload and live update/install smoke testing remain pending.

## Completion shortcuts (0.2.3)

- `telegram_complete_setup` and `/telegram-complete-setup` finish pending managed creation without Add-menu navigation. “Done” is contextual tool guidance, not a global keyword interceptor.
- New pending requests store canonical project path and persistent session ID. Other sessions/projects cannot complete them; legacy requests require explicit local recovery confirmation. Manager mutation compares the exact pending snapshot, preventing cancellation/replacement races from resurrecting requests.
- `/telegram-start` offers the initiating session's pending completion first. Local interactive UI, webhook and transfer confirmations remain required; live smoke testing and reload are pending.

## Photo delivery (released in 0.2.2)

- Added separate `telegram_send_photo` for inline PNG/JPEG delivery with 10 MB, dimension-sum (10,000), and aspect-ratio (20:1) checks. `sharp` is a runtime dependency for actual image decoding/validation.
- Photo/document uploads share request-bound routing, project-file safeguards, captions, and abort-aware upload transport. No conversion, fallback, or metadata stripping. Reload and live inline-photo smoke testing remain pending.

## Current handoff / release checkpoint

- Source and public npm `latest`: **0.3.0**, released from `fece2e438713147d068e4f143bcfe0c151b28bd1`.
- Trusted Publishing run **35470512067** succeeded. Public registry and SLSA provenance were checked; the attestation identifies that commit and `.github/workflows/publish.yml`.
- Tarball SHA-1: `fc0288ab2d7e3feb12d8585363335d9b76e82dae`; 23 files. Local typecheck and **102 tests passed**, zero audit vulnerabilities; pack and diff checks passed. CI validation also succeeded.
- Installed npm on this host remains **0.2.5**. Update and `/reload` are required; neither installation nor live verification was performed during this publication.
- Real Telegram async-send, status-removal, reload and two-session smoke tests remain pending. Keep `artifacts/` out of commits/packages. Do not republish 0.3.0.

### Historical 0.2.5 checkpoint

Last verified against release commit `0bfe2ae`:

- Local and GitHub source version: **0.2.5**.
- npm `latest`: **0.2.5**, published and public-registry verified. Published tarball SHA-1: `17754cdbdc93c7d413ac8889dbd3a3170a32b626`.
- Startup now sends `Connected · ProjectName · IP · vVersion`; `/status` retains branch, hostname, and controls.
- `728a9f8` committed the multi-bot/session-assignment implementation and lifecycle hardening; `a227cbc` switched the publishing workflow to token-free authentication. Both are pushed to `origin/main`.
- Last validation: TypeScript typecheck and **98 tests passed**. `npm audit` reported zero vulnerabilities; npm pack inspection contained 23 intended files, including `CHANGELOG.md`. These are checkpoint results, not guarantees about future edits.
- **Trusted Publishing is verified working.** Run `35464035626` published 0.2.5 from `0bfe2ae` through GitHub OIDC with signed SLSA provenance; the registry attestation identifies that exact commit and workflow. Public registry visibility lagged workflow success by a few minutes; verify the registry rather than immediately retrying publication.
- Earlier OIDC authorization failures were resolved after the user saved the package-specific GitHub Trusted Publisher mapping. Enabling “Allow npm publish” alone was insufficient. The workflow retains filtered OIDC diagnostics.
- Local `npm whoami` also returned `401`. Do not assume previously configured local npm credentials are valid.
- Real Telegram two-session smoke testing of the new lifecycle remains pending. Automated lifecycle tests use mocked Pi contexts and Bot API responses.

### Next steps and future releases

1. Complete real Telegram two-session smoke testing; it was not performed as part of npm publication.
2. Review removal/revocation of any old local npm publishing credentials through secure local/account UI. Never inspect or print token values in model context. OIDC publication no longer requires a local npm token.
3. Keep the verified Trusted Publisher mapping: GitHub owner `mbundgaard`, repository `PiTelegram`, workflow filename `publish.yml`, no GitHub environment name.
4. For an authorized future release, bump the version, validate, push, and dispatch `.github/workflows/publish.yml`. Do not republish 0.2.0, 0.2.1, 0.2.2, 0.2.3, 0.2.4, or 0.2.5. This workflow also runs on a published GitHub release; avoid duplicate publication triggers.
5. Verify workflow success, public registry version, and provenance before updating this checkpoint. The published 0.2.5 tarball additionally includes reconnect recovery and phase-independent public-text streaming; this post-publication checkpoint update is documentation-only.

Do not initialize Git, commit, push, tag, or publish without explicit user authorization for that operation. Documentation review alone is not authorization to publish.

## Architecture and invariants

- Global settings: `~/.pi/agent/pi-telegram/settings.json`; `PI_TELEGRAM_SETTINGS` may override that path. They contain provisioning mode and, in manager mode, manager credentials, update offset, one pending creation request, and a best-effort managed-bot identity catalog. The catalog contains no child tokens.
- Project settings: `.pi/pi-telegram.local.json`, version 2 with a `bots` list. Each entry stores Telegram identity, token, authorized owner, managed/manual origin, and `sessionId` or `null`.
- Legacy version-1 settings load as one unassigned bot without writing during startup; the next mutation writes version 2.
- Assignments use `ctx.sessionManager.getSessionId()`. Enforce at most one bot per non-null session ID in a project. A host-local lease prevents concurrent polling of the same bot across local projects/processes; there is no cross-machine coordination service.
- `session_start` is passive unless an exact assignment matches. It must never prompt or provision. Pi emits shutdown/start for new, resume, fork, and reload; shutdown aborts pending setup and closes polling while preserving assignments for resume.
- Confirm transfers and compare the confirmed project snapshot under the mutation lock. Rollback is compare-and-swap too; never undo an intervening session's decision.
- Release clears only the current session assignment, preserving credentials. Removal requires separate destructive confirmation and deletes only local project credentials, not the Telegram bot or its token at Telegram.
- Acquire the runtime lease before private owner pairing or ordinary polling. Re-adding an already paired project bot preserves its stored owner; changing owner requires removing it and pairing again.
- `proper-lockfile` heartbeat locks renew every ten seconds and become stale after two minutes without renewal. Serialize all manager writes and project mutations. Do not replace this with unchecked PID/mtime-based unlink logic. Live legacy PID locks require the old process to release or reload first.
- Connected processes check ownership every second and disconnect if ownership/credentials change or cannot be verified. Failed switches restore prior state only if it has not changed in the meantime. Notification delivery failure must not prevent release/removal cleanup.
- Save a new managed child unassigned before advancing the manager update offset, then use the normal confirmed assignment flow. A pending creation request is not permission to transfer an existing bot.
- Telegram has no `listManagedBots` or arbitrary private bot username-to-ID lookup. Managed recovery requires a catalog identity, known numeric child ID, or child credentials; usernames must never be invented or derived from project names.
- Startup refuses existing webhooks. Explicit setup must confirm removal before local polling; API helpers must not silently delete webhooks.

## Telegram and AI integration

- Accept only private text and supported document/photo attachments from the stored Telegram owner.
- Ordinary messages are follow-ups; `!` requests steering and `!!` escapes a literal bang. Reject Telegram steering into a running console-originated task.
- One-use in-memory request receipts admitted via Pi's extension input source bind output to the receiving connection. The public transport prefix is formatting guidance, not evidence of origin. Clear receipts on disconnect/session replacement.
- Do not automatically forward assistant text or tool activity. Agent content goes through explicit `telegram_send` calls, including proactive sends from console/scheduled work. Never expose hidden reasoning, prompts, raw tool arguments/results, or credentials.
- Persist explicit model messages as Rich Markdown with optional buttons. Omitted status removes Working; explicit `working` shows a removable status message. No MarkdownV2/plain-text fallback for model answers.
- Stop eligibility follows inbound provenance, independently of status visibility. No settled transcript replay. Background status failures produce rate-limited local warnings.
- Setup requires local interactive TUI; masked tokens must never pass through chat or model-callable tool arguments.

## Source map

- `src/index.ts` — Pi event, command, and tool registration.
- `src/connection-manager.ts` — connection lifetime, shutdown, polling ownership, monitoring.
- `src/setup-flow.ts` — Add/Manage menus, assignment, pairing, creation/recovery, rollback, status.
- `src/setup.ts` — masked input, manager configuration, cancellable pairing UI.
- `src/assignment.ts` — compare-and-swap assignment transactions.
- `src/config.ts` — schema validation/migration, private storage, Git/symlink checks.
- `src/locks.ts`, `src/runtime-lease.ts` — settings and runtime heartbeat locks.
- `src/request-routing.ts` — request receipts and public response lifecycle.
- `src/routing.ts`, `src/messages.ts` — transport notice, steering, public-text extraction.
- `src/bot-api.ts` — identity validation, managed-bot APIs, owner pairing.
- `src/telegram.ts` — polling, native commands, drafts, Rich Messages, uploads.
- `src/files.ts`, `src/photos.ts`, `src/host.ts` — safe attachments, image validation, and startup/status host information.
- `src/updates.ts` — loaded package identity, registry checks, safe npm installation targeting, idle update sequencing and installation locking.
- `tests/` — unit and mocked lifecycle tests, including transfer races, rollback, offline release, cancellation, lease contention, and request-origin isolation.
- `docs/architecture.md` — design and runtime flows.
- `docs/telegram-rich-messages.md`, `docs/telegram-draft-ux-baseline.md` — API evaluation and tested draft UX.

## Security boundaries

- Keep authorization, lifecycle, transport, and credentials in code, not skills or model instructions.
- Never log, display, commit, or put live bot tokens, npm credentials, private keys, or credential settings into model context.
- Global and project credential writes reject tracked/symbolic paths and exclude both destination and temporary-file patterns from Git before writing. Stored JSON is plaintext; restrictive file modes are not encryption or a Windows ACL guarantee.
- Attachments must remain inside the canonical project root, exclude known credentials/repository internals and configured credential paths, and be revalidated before upload. Filename checks do not scan arbitrary file/archive contents for secrets.
- Keep the 50 MB upload limit and 1,024-character caption limit. File delivery requires an active Telegram-originated request.
- Do not copy historical private repositories, cloud credentials, or private Git history into this public repository.

## Validation and activation

Run from this package root:

```bash
npm ci
npm run validate
npm audit --audit-level=moderate
npm run pack:check
git diff --check
```

`proper-lockfile` is a runtime dependency and must remain in `dependencies`, not only `devDependencies`.

After changing the installed local package, run `/reload` in Pi to activate it. Do not claim reload, live Telegram testing, or successful publication unless actually verified. Refresh this handoff when release status or behavior changes.
