# Changelog

Release notes for `@comput/pi-telegram`, newest first. This file is included in every npm package from 0.2.3 onward. Agents reviewing an upgrade should read all entries newer than the installed version, including upgrade notes and limitations. Update checks discover versions; they do not automatically inject these notes into agent context.

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
