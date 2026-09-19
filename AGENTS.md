# Pi Telegram Agent Guide

## Project identity and product direction

Pi Telegram is a globally loaded TypeScript package that makes Telegram a native frontend for live Pi coding-agent sessions. It talks directly to the Telegram Bot API. There is no hosted provisioner, cloud registry, Azure dependency, deterministic project key, or tracked bot binding in the current product.

- Repository: <https://github.com/mbundgaard/PiTelegram>
- npm package: `@comput/pi-telegram`
- Development checkout: `D:\Source\PiTelegram`
- Canonical product name: **Pi Telegram**.

Prefer native Telegram drafts, Rich Messages, commands, documents, media, and controls when they improve the experience. Native Thinking is a generic status placeholder, never a channel for hidden reasoning. Keep model-facing usage guidance in the extension's tool descriptions, prompt guidelines, and transport notice, not exclusively in this development guide: consuming projects will not have this file.

## Photo delivery (released in 0.2.2)

- Added separate `telegram_send_photo` for inline PNG/JPEG delivery with 10 MB, dimension-sum (10,000), and aspect-ratio (20:1) checks. `sharp` is a runtime dependency for actual image decoding/validation.
- Photo/document uploads share request-bound routing, project-file safeguards, captions, and abort-aware upload transport. No conversion, fallback, or metadata stripping. Reload and live inline-photo smoke testing remain pending.

## Current handoff / release checkpoint

Last verified against release commit `3e5f956`:

- Local and GitHub source version: **0.2.2**.
- npm `latest`: **0.2.2**, published and public-registry verified. Published tarball SHA-1: `10e13cc4e9c0bc5efa1d7b950a1d40b84d47cbe1`.
- Startup now sends only `Connected · ProjectName · IP`; `/status` retains branch, hostname, and controls.
- `728a9f8` committed the multi-bot/session-assignment implementation and lifecycle hardening; `a227cbc` switched the publishing workflow to token-free authentication. Both are pushed to `origin/main`.
- Last validation: TypeScript typecheck and **73 tests passed**. `npm audit` reported zero vulnerabilities; npm pack inspection contained 19 intended files. These are checkpoint results, not guarantees about future edits.
- **Trusted Publishing is verified working.** Run `35436172232` published 0.2.2 from `3e5f956` through GitHub OIDC with signed SLSA provenance; the registry attestation identifies that exact commit and workflow. Public registry visibility lagged workflow success by a few minutes; verify the registry rather than immediately retrying publication.
- Earlier OIDC authorization failures were resolved after the user saved the package-specific GitHub Trusted Publisher mapping. Enabling “Allow npm publish” alone was insufficient. The workflow retains filtered OIDC diagnostics.
- Local `npm whoami` also returned `401`. Do not assume previously configured local npm credentials are valid.
- Real Telegram two-session smoke testing of the new lifecycle remains pending. Automated lifecycle tests use mocked Pi contexts and Bot API responses.

### Next steps and future releases

1. Complete real Telegram two-session smoke testing; it was not performed as part of npm publication.
2. Review removal/revocation of any old local npm publishing credentials through secure local/account UI. Never inspect or print token values in model context. OIDC publication no longer requires a local npm token.
3. Keep the verified Trusted Publisher mapping: GitHub owner `mbundgaard`, repository `PiTelegram`, workflow filename `publish.yml`, no GitHub environment name.
4. For an authorized future release, bump the version, validate, push, and dispatch `.github/workflows/publish.yml`. Do not republish 0.2.0, 0.2.1, or 0.2.2. This workflow also runs on a published GitHub release; avoid duplicate publication triggers.
5. Verify workflow success, public registry version, and provenance before updating this checkpoint. The published 0.2.2 tarball includes photo delivery and updated README; this post-publication checkpoint update is documentation-only.

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

- Accept only private text from the stored Telegram owner.
- Ordinary messages are follow-ups; `!` requests steering and `!!` escapes a literal bang. Reject Telegram steering into a running console-originated task.
- One-use in-memory request receipts admitted via Pi's extension input source bind output to the receiving connection. The public transport prefix is formatting guidance, not evidence of origin. Clear receipts on disconnect/session replacement.
- Stream only public commentary and final-answer text. Never expose hidden reasoning, prompts, raw tool arguments/results, or credentials.
- Preserve the hybrid lifecycle: Rich Thinking/tool activity → one evolving plain commentary/final draft → persisted Rich Markdown response. No MarkdownV2/plain-text fallback for model answers.
- Stop eligibility is independent of draft visibility. Background draft failures produce rate-limited local warnings. Settled fallback must not replay an older transcript answer.
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
