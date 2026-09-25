# Changelog

Release notes for `@comput/pi-telegram`, newest first. This file is included in every npm package from 0.2.3 onward. Agents reviewing an upgrade should read all entries newer than the installed version, including upgrade notes and limitations. Update checks discover versions; they do not automatically inject these notes into agent context.

## 0.6.0

**Release candidate — publication pending final checks and CI.** This is a breaking tool-API upgrade. There is no `telegram_send` compatibility adapter. Migrate before activating: use Post for durable text/buttons, Draft start/update/finalize/discard for previews, Edit with returned `messageRef`, and separate Activity working/clear calls. `{}` no longer finalizes or clears anything; finalize the returned `draftRef` and clear Activity explicitly. Ordinary assistant text is still not forwarded. See [migration details](docs/agent-tools.md#migration-from-050).

- Add request-driven embedded action buttons to `telegram_post` through a narrow literal-text `content` alternative, exclusive of Rich Markdown `message`/keyboard buttons. Paragraph inline choices and button rows share existing one-question/owner/one-use safeguards; button posts remain immutable and inactive visual cleanup is best effort. Ordinary keyboard defaults stay unchanged. Document explicitly requested compact HTML tables/expandable quotes through the existing message field; no new mode or arbitrary native payloads. Inline/row clicks and disabled states, compact tables and expandable quotes were owner-observed on an updated client with prior loaded source; after a user-reported reload, inline callback placement and both choices becoming disabled were also confirmed. This is not a repeated row-callback test or independent verification of the loaded path.

- Simplify onboarding around published-package installation, BotFather pairing, a harmless first reply and persistent-session resume. Ship three focused guides separating public usage from unreleased tools and development evidence; clarify safe recovery, credential privacy and distinct disconnect/remove/revoke operations.
- Wrap private pairing instructions and keep the full pairing code readable on narrow terminals without changing setup, token handling or pairing lifecycle. Automated narrow-terminal tests cover this; live pairing/reload remains untested for this change.
- Raise the extension Node engine floor to 20.9.0 to match its existing image dependency; current examined Pi requires 22.19.0+. Keep standard Pi peers and dependency versions unchanged; this is not a broader platform compatibility claim.

- Add explicit `telegram_thinking` start/stop/handoff lifecycle with fixed generic Thinking content. Start returns thinkingRef, optional integer refreshSeconds0–30 default30; stop cancels future refresh locally without native erase. Handoff(ref, full answer snapshot) positively settles the issued pulse within5s before sending a new normal draft ID and returning draftRef; no native-expiry wait or automatic publication. Single ended/stopped metadata entry is not a lock and has no expiry timer; active/in-flight/transition conflicts reject. Uncertain pulse/handoff fences previews until teardown, with no remote-cancellation guarantee. Earlier no-argument diagnostic calls are replaced by explicit actions. No custom Thinking text/reasoning/mirroring. After a user-reported reload, the owner confirmed direct start → handoff → update → finalize as “perfect”; no redundant stop was used.

- Add a bounded omitted-reply reminder: only processed authenticated Telegram input, after genuine settlement plus five-second grace, can trigger one same-connection nonrecursive agent prompt. No transcript forwarding, generated Telegram answer, console/proactive watchdog or task retry. Persistent reply-tool attempts suppress conservatively (including uncertain/preflight failures); transient drafts/Working/typing do not. New work, pending messages, Stop/disconnect/replacement and stale assignment suppress reminders. After a user-reported reload, the omitted-reply reminder actually fired and a reply was posted. This does not verify exact timer duration or every no-loop/suppression race.

- Add opt-in `telegram_chat_action` native-typing diagnostic: one pulse or bounded background refresh (0–30 seconds), returning after first API acceptance. Independent of Working/Post/Draft/Edit; no clear action or automatic mirroring. An isolated typing-alone source test was owner-observed; other combinations remain unverified.

- Bundle an optional `pi-telegram` skill with focused usage recipes for today's tools: conversation/formatting, explicit activity and drafts, buttons, request-bound files/photos, and asynchronous progress. Declare skill discovery and include references in npm packaging.
- **Breaking:** remove generic `telegram_send`. Use `telegram_post` for persistent replies/buttons, `telegram_draft` for explicit start/update/finalize/discard with full replacement text, `telegram_edit` with returned persisted references, and independent `telegram_activity` working/clear. No prefix/status-omission inference; Post/Edit/Draft do not clear Working. File/photo tools remain request-bound.
- Decouple authenticated input and guarded Stop from outbound/control UI waits. Question invalidation and approval admission happen before cleanup/notices; ordinary text is accepted during downloads while additional files are rejected. Explicit API delivery remains bounded/ordered, never waits for model/human replies. No worker-termination promises.
- Add package/reference/schema and integration checks. Tool contracts remain mandatory; skill loading is optional/on-demand, not guaranteed.
- Broaden credential-like upload blocking to case-insensitive `credentials.json` and `*.credentials.json`, preserving the former protected filename without product-specific knowledge.
- Keep extensions independent: the proposed cross-extension steering integration was withdrawn before activation. Original unrelated-console protection remains; unknown input can clear the Telegram request association and cause a busy steering refusal. This release does not fix that limitation.
- After a user-reported reload, the owner confirmed Post/Edit/Draft update/finalize and Working clear as “perfect”, direct Thinking handoff as “perfect”, inline callback placement/disabled choices as “perfect”, and compact tables/expandable quotes as “nice”. Loaded source path was not independently verified. The owner declined two-session testing and accepted it as an untested release limitation; host cancellation, adverse-network resilience and skill adherence remain unverified. Publication and shared npm installation are not yet claimed.

## 0.5.0

- Route ordinary text as steering while a Telegram-originated task is running, or as a new turn when idle, without requiring a prefix. Remove special `!`/`!!` parsing: leading bangs remain literal, unmodified text. Keep `/steer` as an explicit command.
- Remove queued acknowledgements. Buttons and attachments remain follow-ups; unrelated console tasks remain protected by a rejection/resend notice. Steering does not forcibly cancel running tools.
- Shorten inbound guidance to explicit replies, milestone progress and Rich Markdown formatting; keep draft mechanics in tool guidance. Clarify explicit activity control separately from draft streaming: set Working at work start and while continuing, refresh before expiry, and omit it when done or waiting for the user. No automatic activity mirroring.
- Upgrade note: ordinary busy text now steers instead of queueing; leading bangs are preserved literally. Installation/reload is required to activate this release. Live routing and two-session verification remain pending.

## 0.4.1

- Use plain `sendMessageDraft` previews to avoid the slow Rich Draft animation observed on mobile. Keep explicit full-snapshot prefix matching and Rich Markdown final delivery unchanged.
- Cap only preview text at 4,096 characters, visibly mark truncation, and avoid splitting surrogate pairs. Retain full input for matching and finalization; explain the distinction in the tool description.
- The user confirmed an isolated plain-draft test rendered correctly. Integrated live verification remains pending; no installed-package change.

## 0.4.0

**Delivery contract change:** messages with `status: working` and no buttons are now temporary drafts rather than immediately persisted messages. Agents must finalize by omitting status. Update and reload to activate; live client rendering remains pending.

- Add explicit native draft streaming to `telegram_send`: full accumulated text with `status: working` updates the same active draft when the exact previous text is a prefix. Different text persists the previous draft and starts another; identical text avoids a duplicate write.
- Omitted status finalizes the supplied text or pending draft and clears Working. Buttons always persist. Status-only Working preserves the draft; `{}` finalizes it. Stop/disconnect/inactivity expiry discard unfinished state without publishing it.
- Describe these rules in the tool description, model guidelines, and inbound reply notice. No automatic assistant streaming or cross-message prefix matching. Live rendering and activation remain pending.

## 0.3.0

**Breaking change:** agents must use `telegram_send` for Telegram replies and progress. `telegram_ask` is removed; ordinary assistant text is no longer forwarded. Update the npm installation and reload to activate. Live asynchronous messaging and reload smoke testing remain pending.

- Replace `telegram_ask` and automatic assistant response streaming with explicit `telegram_send`: optional Rich Markdown message, optional Working status, and optional authenticated choice buttons. Omitting status removes the indicator; status-only calls are supported.
- Allow proactive explicit text sends from console/scheduled tasks through the current session's verified assignment. Retain request-bound file/photo safeguards and reject stale inbound work after connection replacement.
- Remove automatic response phase/tool lifecycle tracking. Inbound delivery supplies reply guidance and continues polling independently. Working is a removable heartbeat message with 15-minute expiry and best-effort stop/disconnect cleanup; no Idle label. Control and queue acknowledgements remain extension-controlled.

- Send the required Connected notice before optional command-menu setup. Menu API calls now run in connection-bound background work, so slow/failing menus cannot consume the startup deadline or undo a successful connection.
- Remove the unused Git-branch lookup from startup; `/status` still includes the branch.
- Report an existing connection as ready only after Telegram accepts its Connected notice. Keep failed-notice cleanup/retry behavior.
- Add regression tests for stalled menu calls, menu errors, cancellation and readiness during notification delivery. Live reload verification remains pending; installed npm copies are unchanged until updated.

## 0.2.5

- Stream authenticated public assistant text without requiring commentary/final-answer phase metadata. The first public text switches to a plain preview immediately; subsequent updates remain coalesced to limit API traffic.
- Preserve multiline/code formatting and replace the preview with the current message's text. Retain readable progress plus generic activity during thinking/tools; never stream hidden reasoning, tool payloads or unrelated console output.

- Retry assigned-session startup connection failures with bounded attempts and backoff (1, 3, 10, then 30 seconds) until success or session shutdown. Recheck persisted assignment before every attempt; never provision or reclaim a transferred/released bot.
- Treat a failed connection notice as a failed startup connection instead of silently claiming success. Retry attempts can repeat a notice whose delivery was uncertain.
- Add regression coverage for transient startup failure, cancellation, and repeated shutdown/start cycles. Live reload/update and streaming verification remain pending. Update the installed npm package and reload to activate these changes.

## 0.2.4

- Add `telegram_ask` for Rich Markdown questions with 1–8 custom inline choice buttons.
- Route owner-selected answers as authenticated follow-ups to the originating connection. Sending a question is not approval.
- Reject wrong-owner/chat/message, stale and duplicate callbacks. Questions expire after 15 minutes, replacement, typed answers, stop or disconnect; keyboard cleanup is best-effort.
- Reject duplicate button labels, fence slow question sends against typed answers/disconnects, and prevent expired timers from affecting replacement questions.
- Report uncertain answer delivery without exposing internal errors or automatically replaying a choice.
- Live Telegram question/button testing remains pending.

## 0.2.3

### Added

- `telegram_complete_setup` and `/telegram-complete-setup` complete an existing managed-bot request without navigating the Add menu. After creation and pressing Start in Telegram, tell the initiating agent "done".
- `/telegram-start` offers matching pending completion first.
- Startup messages include the loaded extension version: `Connected · ProjectName · IP · v0.2.3`.
- Background npm latest-version checks on startup/reload, with an eight-second timeout and `PI_OFFLINE` support.
- Native **Update to vX.Y.Z** / **Not now** buttons for supported npm installations. Only the paired owner can approve; stale, duplicate, wrong-chat and wrong-message callbacks cannot install updates.
- Exact-version npm installation after Pi becomes idle, host-local update locking, installed-version verification, and reload of only the approving session.
- This packaged changelog and a release-notes link in update notices.

### Incoming attachments

- Receive private documents/photos from the paired owner, with captions delivered as follow-up instructions and saved inbox paths. Captionless files prompt the agent to ask what to do first.
- Stream downloads into a Git-ignored, unique-name project inbox with 20 MB file and 100 files/100 MB storage limits. Partial downloads are cleaned up; retained files are removed manually.
- Download/received/queued feedback, non-blocking polling, and `/stop` cancellation. Disconnects prevent delivery into a replacement session.
- Only one file downloads per connection; extra attachments/instructions receive an explicit resend notice. Albums and other incoming media types remain unsupported. No automatic execution or archive extraction. Live reception smoke tests remain pending.

### Working-status fixes

- Keep request activity alive after completed responses until actual settlement, including truncated-response continuation and automatic compaction.
- Track overlapping tools by call ID so finishing one does not hide another active tool.
- Preserve commentary with a generic activity label and visible heartbeat rather than invisible refresh-only changes.
- Acknowledge queued follow-ups without replacing the active request's draft.
- Automated regression tests cover these paths; live Telegram visibility testing remains pending.

### Safety and upgrade notes

- New pending bot requests are bound to the canonical project path and initiating persistent Pi session. Completion rechecks the pending snapshot under the manager lock and preserves owner, webhook and transfer safeguards.
- Pending requests created by older versions need one explicit local recovery through **Add a bot… → Complete**. They cannot use the direct completion shortcut until recovered.
- Automatic installation is restricted to recognized Pi global/project npm locations using the default npm CLI. Local source/Git checkouts, symlinked packages, pinned Pi sources, custom package managers and unrecognized installations only receive update notices.
- Updates to a shared installation affect other sessions when they reload; those sessions are not restarted automatically.
- Failed/interrupted installs are not automatically retried or rolled back. Inspect or repair the installation locally before retrying. Raw npm output is not sent to Telegram.
- Unassigned sessions remain silent and do not connect to Telegram. Registry-check failure does not prevent connection.
- Reload is needed to activate this release. Live setup-completion and update-button/install smoke testing remain pending; automated tests do not replace live testing.

## 0.2.2

### Added

- Separate `telegram_send_photo` tool for requested inline PNG/JPEG delivery.
- Actual image decoding/validation using the runtime `sharp` dependency: maximum 10 MB, width + height at most 10,000 pixels, and aspect ratio at most 20:1.
- Shared photo/document upload safeguards, captions, request-bound routing, cancellation and delivery-error handling.

### Notes

- `telegram_send_file` continues to deliver original bytes as documents (maximum 50 MB).
- No automatic conversion, document fallback or metadata stripping. Telegram may resize/compress photos.
- Incoming attachments and albums were not supported in 0.2.2. Live inline-photo smoke testing remains pending.

## 0.2.1

### Changed

- Replaced the verbose startup notice with `Connected · ProjectName · IP`.
- Kept branch, hostname and controls in `/status`.
- Updated setup, lifecycle and security documentation.

## 0.2.0

### Added and changed

- Multiple project bots with persistent Pi-session assignments and passive startup.
- Confirmed transfers, release without credential deletion, and separate local credential removal.
- Heartbeat polling leases, serialized settings changes and assignment rollback protections.
- Request-bound response routing and owner-only Telegram input.
- Token-free npm Trusted Publishing through GitHub Actions with provenance.

### Notes

- Legacy project settings load as one unassigned bot and migrate on the next mutation.
- Real two-session Telegram lifecycle smoke testing remains pending.
