# Pi Telegram Agent Guide

## Project identity and product direction

Pi Telegram is a globally loaded TypeScript package that makes Telegram a native frontend for live Pi coding-agent sessions. It talks directly to the Telegram Bot API. There is no hosted provisioner, cloud registry, Azure dependency, deterministic project key, or tracked bot binding in the current product.

- Repository: <https://github.com/comput-sh/pi-telegram>
- npm package: `@comput/pi-telegram`
- Development checkout: `D:\Source\PiTelegram`
- Canonical product name: **Pi Telegram**.

Prefer native Telegram drafts, Rich Messages, commands, documents, media, and controls when they improve the experience. Native Thinking is a generic status placeholder, never a channel for hidden reasoning. Keep model-facing usage guidance in the extension's tool descriptions, prompt guidelines, and transport notice, not exclusively in this development guide: consuming projects will not have this file.

## Unreleased independent follow-up routing

- Ordinary owner text and explicit `/steer` during unrelated busy work now queue a Pi follow-up turn rather than sending the local-console refusal. Active authenticated Telegram work still receives steering; idle behavior and button/attachment follow-ups are unchanged. No console interruption, automatic queued acknowledgement, peer-extension detection/integration or wait for agent completion.
- Existing receipt admission only marks pending work; it does not grant Stop/file/reminder authority to the console task. Authority begins when that authenticated user message actually starts. Stale queued receipts remain invalid after disconnect/replacement. No receipt/Stop/watchdog implementation was widened.
- Registered-extension integration tests cover admission while console work is busy, no console Stop/file authority, later begun-turn file authority, continuing Telegram steering and stale queued replacement isolation. These are mocked host-event tests, not live activation. Existing feedback work remains unchanged and disabled pending its endpoint. Fresh combined typecheck and213 tests (none skipped), audit zero vulnerabilities, pack40 and diff checks passed; independent routing review approved with213 passing tests, audit zero vulnerabilities and pack40. No live activation; feedback remains disabled pending its endpoint.

## Unreleased native feedback (disabled pending endpoint)

- Native `/feedback` stays inside Telegram transport: dedicated ForceReply, exact owner/private-chat/prompt reply binding, plain preview with loaded version and destination, one-use Submit/Cancel. No model tool, Pi input, receipt/watchdog trigger, ordinary-message capture, rating or automatic solicitation.
- `src/feedback-endpoint.ts` deliberately exports undefined. Index/ConnectionManager always pass known bot identity for stale-prompt/preview rejection, and pass optional endpoint/version only when configured. No environment/settings override or setup UI. Missing/invalid endpoint refuses before collecting text; no placeholder service or backend implementation.
- Fixed15-minute deadline, nonblank1–2000 UTF-16 text,10-second HTTP timeout. Submit alone sends `{feedback,version}` over HTTPS, no redirects/retries/body parsing; HTTP200 including empty body succeeds. No Telegram/project/session identity or credentials added. Own-bot stale markers are rejection-only, never consent. Native cleanup is best effort.
- Agent questions remain independent except existing global `stop`/`/stop`, which retains priority even inside ForceReply and does not expand abort authority. Other commands in exact feedback replies are literal text.
- Source-only validation passed typecheck,211 tests (none skipped), audit zero vulnerabilities, pack dry-run40 files and diff checks. Independent review approved with211 passing tests, audit zero vulnerabilities and pack40. The endpoint remains undefined/disabled; no live feedback UI, HTTP submission or activation was performed. Version/dependencies remain0.6.0/unchanged; no publication, installation or reload for this work.

## 0.6.0 released

- Authorized 0.6.0 publication succeeded and public npm latest is verified. The exact release commit and artifact evidence are recorded in the current checkpoint below. Shared npm installation remains 0.5.0; source testing/reload is not package installation. This publication did not install or reload anything.
- After a user-reported reload, single-session Post/Edit/Draft update/finalize/Working clear and direct Thinking start → handoff → update → finalize were reported “perfect”. Inline callback placement and both choices disabled were “perfect”; compact tables/expandable quotes were “nice”; the omitted-reply reminder actually fired and posted. Loaded source path was not independently verified. This does not repeat the row-callback test or prove exact timer/no-loop behavior.
- The owner declined two-session testing and accepted it as an untested release limitation. Host cancellation, adverse-network behavior and skill adherence remain unverified. No cross-extension bridge or replacement steering fix is included; the original busy-console guard remains.
- Trusted Publisher mapping comput-sh/pi-telegram, publish.yml, blank environment is verified working by successful publication. Registry hashes and decoded SLSA linkage were independently checked; independent DSSE/certificate-chain/Rekor verification was not performed.
- Final checks passed typecheck and 195 tests (none skipped), audit zero vulnerabilities, package dry-run38 files and diff check on Node22/npm10 and isolated Node24/npm12. A test-only npm pack JSON compatibility fix supports strict single-package array and name-keyed formats without weakening package safety checks; no runtime/dependency change. Release-commit CI and publication validation succeeded.

## Historical source-development checkpoints (superseded by release evidence above)

- The proposed cross-extension steering integration was withdrawn and removed from source. Original authenticated-request routing and unrelated-console protection remain; no replacement design is implemented. The local Telegram-only source launcher remains unexecuted. Fresh rollback validation passed typecheck, 194 tests (none skipped), pack dry-run38 files and diff checks. Audit covered all22 production modules: only own Telegram/configuration/lifecycle, ordinary Pi host APIs, Git safeguards/metadata and own npm updates remain. Generic case-insensitive credentials.json / *.credentials.json upload protection replaces a product-specific basename without narrowing protection. Independent rollback review approved: all22 production modules and30 test files audited; no peer-extension awareness remains in source or distributed guidance. The original busy-console guard is restored. Loaded copies remain unchanged until a separately authorized restart; prior scoped live observations do not verify this rollback.

- Request-driven advanced layouts: `telegram_post` now takes exactly one of Rich Markdown message or narrow literal embedded content; content excludes top-level keyboard buttons. Paragraph text/button parts and button rows share the existing one pending question, owner/nonce/message/one-use safeguards; no raw callbacks/payload or extra approval authority. Limits are16 blocks/32 paragraph parts/8 total choices/4096 derived visible characters. Existing keyboard defaults remain unchanged; advanced embedded buttons, compact tables and expandable quotes are discoverable but only used on explicit request/preference, not enabled as a mode. HTML table/quote recipes use the unchanged message field; formatted HTML plus embedded content is outside the initial subset. Builder, Transport and independent Reviewer validation passed: typecheck and 193 tests (none skipped), pack dry-run (38 intended files), and diff check; no new dependencies. Independent advanced-layout review approved. The owner subsequently observed inline/row button rendering, clicks and disabled states, compact tables and expandable quotes on an updated client using prior loaded source; this does not verify the post-rollback checkout. These are unreleased source changes; shared/public npm remains 0.5.0.

- Approved onboarding checkpoint: README now prioritizes public npm 0.5.0 installation, BotFather pairing, harmless first reply, persistent-session resume and safe troubleshooting/removal. Three explicitly packaged guides separate public usage, unreleased agent contracts and source evidence. Pairing instructions wrap on narrow terminals without changing setup lifecycle; the Node engine floor is 20.9.0 (current examined Pi requires 22.19.0+), with standard Pi peers unchanged. Builder and independent Reviewer passed typecheck, 174 tests (none skipped), pack dry-run (36 intended files), and diff checks; lockfile change is root engine metadata only. Narrow pairing UI coverage is automated, not live pairing/reload. No version bump, publication, installation or reload in this scope; earlier validation counts below are historical checkpoints.

- Thinking now has explicit `telegram_thinking` start/stop/handoff actions, replacing the earlier no-argument diagnostic. Start optional integer refreshSeconds0–30 DEFAULT30 returns thinkingRef after first acceptance; stop freezes future refresh locally, not native erase; handoff(ref, full answer snapshot) positively settles an issued pulse within5s before a NEW normal native draft ID and returns draftRef. No natural-expiry wait for handoff. Only active/initial/in-flight/transition state excludes other preview starts; one retained metadata entry is not a lock and has no expiry timer. New starts/successful handoff/ownerStop/disconnect retire refs. Uncertain pulse/handoff fences previews until teardown (no remote-cancellation guarantee); Post/Edit/Activity remain available. No freeform Thinking/reasoning/mirroring or durable preview evidence. Final Transport and independent Reviewer lifecycle validation passed: typecheck and 167 tests (none skipped), diff check; prior pack dry-run (33 intended files) and unchanged lockfile remain verified. Independent lifecycle review approved. Source lifecycle activation and scoped owner observations are recorded below; direct handoff without stop remains unobserved. The prior164-test diagnostic checkpoint is superseded by this lifecycle implementation. Normal guidance is start → direct handoff → draft update/finalize: handoff already stops future refresh, so no redundant stop or artificial sleep. Standalone stop is optional local refresh control, not native erase. refreshSeconds bounds scheduled refresh, not exact visible duration; model/tool/API latency and the up-to-five-second positive-pulse barrier can contribute without measured attribution.

- Added a one-time omitted-reply reminder for latest authenticated inbound receipts that actually begin processing: five-second grace after agent_settled, only when no durable reply-tool attempt exists. Same-connection idle-only synthetic receipt is nonrecursive; no transcript forwarding, automatic user reply or task retry. Any executed Post/finalize/Edit/file/photo attempt suppresses conservatively, including preflight/uncertain failures; transient previews/Working/typing/control notices do not. New work, Stop/disconnect/replacement and stale assignments suppress. Builder and independent Reviewer validation passed: typecheck and 156 tests (none skipped), pack dry-run (32 intended files), diff check and unchanged lockfile. Reviewer approved the reminder; the owner subsequently observed live reminder injection on prior loaded source, not a post-rollback activation. Recovery is best effort and conservatively suppressed by any executed durable reply attempt; prior counts below are historical snapshots.

- Added `skills/pi-telegram/SKILL.md` and focused references for today's tools; `pi.skills` and npm files allowlist include them. Skills are optional/on-demand, not guaranteed loaded; extension tool contracts remain mandatory.
- Added opt-in `telegram_chat_action` diagnostic with fixed typing action and optional integer `refreshSeconds` 0–30 (default 0 pulse). Returns after first acceptance, refreshes in a bounded independent background loop. No clear action, Working coupling or live-visibility guarantee; comparison tests require coordinated activation and separate authorization. Mock/schema validation passed; the owner reported that an isolated 12-second typing test looked good. This is scoped single-session evidence, not a visibility guarantee.
- Generic `telegram_send` is removed. Explicit Post/Draft/Edit/Activity tools separate persistent messages, full-replacement previews, referenced edits and generic Working. No implicit status/prefix behavior; file/photo and Stop provenance safeguards remain.
- Admission and guarded cancellation are independent of control cleanup/outbound delivery. Notices and keyboard cleanup run in bounded supervised background work; ordinary text is admitted during downloads, extra files are rejected. No model/human-response waits, automatic forwarding or worker-termination promises.
- Packaging/reference/schema and new integration tests cover the explicit API. Historical typing-diagnostic checkpoint: Builder, Transport and independent Reviewer passed typecheck and 145 tests (none skipped), pack dry-run (31 intended files including seven skill Markdown files and transport queue), and diff check. Latest lifecycle checkpoint is 167 tests and 33 package files as recorded above. Prior audit found zero vulnerabilities; dependencies are unchanged. Provider-compatible flat string enums have runtime action/ref guards; no dependency/lockfile changes remain. Those historical checks did not activate the source; subsequent source activation and observations are recorded below. No new version or publication has occurred.
- Historical source testing before the latest user-reported reload: development source was activated, while published/shared npm remains 0.5.0 unchanged. The owner confirmed single-session Post/Edit/Draft with the expected two saved messages, plus a button follow-up repeating the draft test. Typing alone with a requested 12-second window looked good. Thinking alone with 12-second refresh was clear and expired naturally. Two explicit start → stop → handoff → update → finalize tests were described as “perfect”; visible Thinking lasted about 12–15 seconds despite a deliberate 3-second pause. Latency was not measured and no cause is attributed. Direct handoff without stop has not yet been owner-observed.
- Remaining release limitations: two-session testing explicitly declined/accepted as untested; host cancellation, slow-network behavior and skill discovery/adherence unverified. Latest user-reported-reload single-session evidence is recorded above; loaded path is not independently verified. Per-call runtime visibility-unverified messages remain appropriate: the tool cannot see the owner's UI.
- Host 0.5.0 installation was separately verified after publication. Source testing is distinct from that npm installation; the published checkpoints below retain their earlier release-time host state.

## State-based routing and model guidance (released in 0.5.0)

- Ordinary text steers active Telegram-originated work and starts a normal turn when idle. No queued acknowledgement. Leading `!` characters are literal text, unchanged; `/steer` remains an explicit command.
- The inbound notice now uses the approved concise reply/progress/formatting guidance. Activity guidance is prominent and distinct from draft streaming in the tool contract; transport semantics are unchanged.
- Button replies and attachments remain follow-ups. The console-origin protection remains: reject Telegram steering into unrelated console work with a resend notice rather than silently queueing it.
- Source and regression tests updated. Local validation: typecheck and 116 tests passed; pack/diff checks passed (23 package files), audit found zero vulnerabilities. Authorized 0.5.0 publication is verified below; activation and live routing verification remain pending.
- Host 0.4.1 was installed and the user confirmed integrated plain previews, replacement updates, and finalization looked good. This confirms that single-session visual test, not two-session lifecycle behavior.

## Plain-preview rendering fix (released in 0.4.1)

- User reported 0.4.0 Rich Draft tests showed only “TE” twice before final persistence. An isolated plain `sendMessageDraft` test was visually confirmed as good. This supports the transport change but does not isolate heartbeat effects or verify integrated behavior.
- Local source now uses plain previews, bounded to 4,096 characters with marked, surrogate-safe truncation. Full snapshots remain intact for prefix matching and Rich Markdown final persistence. Tool description clarifies preview limits versus input limits.
- Host 0.4.0 was installed and reload was followed by live test messages. User authorized publication as 0.4.1. Public npm latest and release provenance are verified below; installation was separate; the subsequent single-session visual confirmation is recorded in the current handoff below. Two-session smoke testing remains pending.

## Explicit draft streaming (released in 0.4.0)

- `telegram_send` message + Working without buttons now creates a temporary Rich Message draft. Full accumulated text extending the active draft's exact prefix updates that draft; different text persists the old draft and starts another. Matching never applies to already-persisted messages.
- Omitted status finalizes supplied text (or the pending draft for `{}`) and removes Working. Status-only Working retains the draft. Buttons always persist. Stop/disconnect/15-minute inactivity expiry discard pending state without publishing unfinished text; Telegram previews expire naturally.
- Tool description, prompt guidelines, inbound notice, README and changelog explain the full-snapshot protocol explicitly. No automatic assistant streaming. Local validation: 106 tests passed and typecheck passed; live rendering remains pending. User authorized publication as 0.4.0; public npm latest and release provenance are verified below. Installation is not part of this publication. Host npm was previously updated and verified as 0.3.0, and explicit Telegram sends have succeeded live; full draft-streaming verification remains pending.

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

- Source and public npm `latest`: **0.6.0**, released from `9ab9c133daeef0f23b96b7afefe773581bca0c87`.
- CI **36181107612** and Trusted Publishing **36181188483** succeeded. Earlier run **36180596310** failed validation and its publish step was skipped; it did not publish a competing artifact.
- Independent download verification: all **38 files** byte-match the release commit. SHA-1: `e0f8a6c455c65c91386a3e03c5ae11cc6e2758d3`. SHA-512 matches registry integrity and the decoded SLSA subject digest.
- Registry SHA-512 integrity: `sha512-BlLloQEmVOd8DgktFvOVVntA9cOGto26JlfRIIzx4JxLI929d5Y+s2/9Y1+mGGmYDgG1HLnmYzgCMfXhLertsg==`.
- Decoded SLSA v1 identifies `comput-sh/pi-telegram`, `.github/workflows/publish.yml`, the exact release commit and run **36181188483**, attempt **1**. Hashes and payload linkage were checked, not an independent DSSE/Sigstore certificate-chain/Rekor verification.
- Final validation: typecheck, **195 tests** (none skipped), audit zero vulnerabilities, pack38 and diff checks; Node22/npm10 and Node24/npm12 passed. The npm12 fix is test-only and retains strict package safety assertions.
- Installed/shared npm remains **0.5.0**. Single-session source observations are scoped above; two-session testing was declined and accepted as untested, and host cancellation/adverse-network limitations remain. The original busy-console guard is unchanged.
- The published tarball includes its pre-publication documentation snapshot. This post-publication checkpoint is documentation-only and does not alter that immutable artifact. Do not republish 0.6.0. Keep artifacts and hidden local runtime state out of commits/packages.

### Historical 0.5.0 checkpoint

- Source and public npm `latest` at that checkpoint: **0.5.0**, released from `6275bfdfbe6d47778bf12b8f20331c9c1ca3e96e`.
- Trusted Publishing run **35530702310** succeeded. Public registry metadata and SLSA attestation identify that exact commit and `.github/workflows/publish.yml`; the attestation names run attempt 1.
- Downloaded tarball SHA-1: `57ab82707b02434d71890f560e78f869aa336628`; 23 files. SHA-512 matches registry integrity and the SLSA subject digest.
- Fresh release validation passed: `npm ci`, typecheck and **116 tests**, audit (zero vulnerabilities), pack check (23 intended files), and diff check; workflow CI validation succeeded.
- Host installation remains **0.4.1**; this publication did not install or reload 0.5.0. Single-session 0.4.1 visual confirmation does not verify 0.5.0 routing or two-session lifecycle behavior; those live tests remain pending.
- Keep `artifacts/` and hidden local runtime-state directories out of release commits and packages. Do not republish 0.5.0.

### Historical 0.4.1 checkpoint

- Source and public npm `latest` at that checkpoint: **0.4.1**, released from `7b40e1d9783b0716ba299917f1f2a616382e6ee4`.
- Trusted Publishing run **35473205305** succeeded. Registry metadata and SLSA attestation identify that commit and `.github/workflows/publish.yml`.
- Tarball SHA-1: `4423bbca035c443ee2ca98b7496c283786a8bd3d`; 23 files. **107 tests passed**, typecheck/pack/diff checks passed, zero audit vulnerabilities; CI validation succeeded.
- Publication itself did not install or reload 0.4.1. Subsequently, host **0.4.1** was installed and the user confirmed integrated plain previews, replacement updates, and finalization looked good. This confirms single-session visuals only; two-session smoke testing and activation/live verification of unreleased changes remain pending.
- Keep `artifacts/` out of commits/packages. Do not republish 0.4.1.

### Historical 0.4.0 checkpoint

- Source and public npm `latest`: **0.4.0**, released from `fff2a5251be0df4cd1a230a6d5960403518b9970`.
- Trusted Publishing run **35472260405** succeeded. Registry metadata and SLSA attestation identify that commit and `.github/workflows/publish.yml`.
- Tarball SHA-1: `516b460faa91dee81816aed396b3d7ee033a5159`; 23 files. **106 tests passed**, typecheck/pack/diff checks passed, zero audit vulnerabilities; CI validation succeeded.
- Host npm was last updated and verified as **0.3.0**. This publication did not install or reload 0.4.0. Explicit 0.3.0 sends have succeeded live; 0.4.0 draft rendering/finalization and two-session smoke testing remain pending.
- Keep `artifacts/` out of commits/packages. Do not republish 0.4.0.

### Historical 0.3.0 checkpoint

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

1. Two-session smoke testing remains unperformed; the owner declined it and accepted that release limitation. Perform it only if separately requested.
2. Review removal/revocation of any old local npm publishing credentials through secure local/account UI. Never inspect or print token values in model context. OIDC publication no longer requires a local npm token.
3. The Trusted Publisher mapping is GitHub owner `comput-sh`, repository `pi-telegram`, workflow filename `publish.yml`, no GitHub environment name. Successful 0.6.0 publication verified this mapping; exact registry/artifact and decoded provenance linkage are recorded above.
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
- Ordinary text steers authenticated Telegram work while busy and starts normally when idle; leading `!` characters remain literal. Ordinary text and explicit `/steer` targeting unrelated busy work use a follow-up turn instead, never console steering. Queue admission does not grant request authority until its authenticated user turn begins. Buttons and attachments remain follow-ups. Do not send queued acknowledgements.
- One-use in-memory request receipts admitted via Pi's extension input source bind output to the receiving connection. The public transport prefix is formatting guidance, not evidence of origin. Clear receipts on disconnect/session replacement.
- Do not automatically forward assistant text or tool activity. Agent content goes through explicit `telegram_post`, `telegram_draft`, `telegram_edit` and `telegram_activity` calls, including proactive sends from console/scheduled work. Generic `telegram_send` is removed in unreleased source. Never expose hidden reasoning, prompts, raw tool arguments/results, or credentials.
- The concise inbound notice guides replies, milestone progress and Rich Markdown formatting, not authentication; streaming mechanics remain in tool descriptions/guidelines.
- Explicitly call activity `working` at work start and while activity continues; refresh before 15-minute expiry. Call activity `clear` when no work continues; it does not finalize/discard drafts. Execution/worker activity is not automatically mirrored.
- Post persists Rich Markdown with optional buttons; Draft explicitly starts/updates/finalizes/discards full replacement previews, without prefix inference. Edit replaces a returned non-button messageRef. Refs are connection-scoped; stale refs are rejected. No MarkdownV2/plain-text fallback for model answers.
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
