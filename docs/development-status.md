# Development status and evidence

[Onboarding](../README.md) · [0.6.0 tool contracts](agent-tools.md) · [Changelog](../CHANGELOG.md)

## Pre-publication checkpoint — 2026-09-25

At this checkpoint, candidate package metadata is **0.6.0**; publication is pending final checks and CI. Public npm and the shared npm installation remain **0.5.0**. Development source is activated in a single testing session; this is not a new npm installation or publication. New Post/Draft/Edit/Activity tools, Thinking lifecycle, typing diagnostic, omitted-reply reminder and bundled usage skill are unreleased. Do not instruct npm 0.5.0 users to call those tools.

The published 0.5.0 release added state-based incoming text, literal leading bangs, no queued acknowledgements and concise inbound guidance. Its generic `telegram_send` API remains documented in the changelog. Release provenance and exact historical installation checkpoints are preserved in the repository's [AGENTS.md](https://github.com/comput-sh/pi-telegram/blob/main/AGENTS.md); later source testing does not rewrite those release-time facts.

Historical 0.4.1 switched previews from Rich Drafts to plain `sendMessageDraft`, bounded to 4,096 characters with marked truncation, while retaining full snapshots for prefix matching/final persistence. The owner confirmed that single-session plain-preview/replacement/finalization test. The unreleased explicit API instead uses returned draft references and full replacements, without prefix inference.

Request-driven embedded action buttons and advanced-layout recipes are a further unreleased addition. They do not change public/shared npm 0.5.0. Builder, Transport and independent Reviewer passed typecheck, **193 tests** (none skipped), pack dry-run **38 intended files**, and diff checks, with no new dependencies; independent advanced-layout review approved. The owner subsequently observed inline and row button rendering, clicks and disabled states, compact tables and expandable quotes on an updated client using prior loaded source. These observations do not verify the post-rollback checkout. These results supersede the historical validation counts below, not their scoped live observations.

## Scoped owner observations

The owner confirmed single-session Post/Edit/Draft behavior with the expected two saved messages, and a button follow-up repeating the draft test. Typing alone with a requested 12-second window looked good. Thinking alone with 12-second refresh was clear and expired naturally.

Two explicit **start → stop → handoff → update → finalize** tests were described as “perfect”; visible Thinking lasted about 12–15 seconds despite a deliberate 3-second pause. Latency was not measured, so no cause is attributed. A later test after a user-reported reload confirmed direct handoff without stop, as recorded below. Per-call tool acceptance remains distinct from seeing a client's UI.

The owner also observed live omitted-reply reminder injection on prior loaded source. This is scoped evidence, not post-rollback activation or proof of every suppression race.

### Latest user-reported reload observations

The owner reported single-session Post/Edit/Draft update/finalize and Working clear as “perfect”, and **direct Thinking start → handoff → update → finalize** as “perfect”. Inline callback placement and both choices becoming disabled were “perfect”; compact tables and expandable quotes were “nice”. The omitted-reply reminder actually fired and a reply was posted. These observations follow a user-reported reload; the loaded source path was not independently verified. They do not repeat row-callback testing or prove exact timer duration/no-loop behavior.

The owner explicitly declined two-session testing and accepted it as an untested release limitation. Host cancellation, adverse-network behavior, skill discovery/adherence, and complete photo/reception/setup-completion/update-button/install smoke tests remain unverified. Automated mocks do not establish these results.

## Source independence and steering limitation

The proposed cross-extension steering integration was withdrawn and removed before activation. Pi Telegram uses only its own authenticated receipts and ordinary Pi host APIs. Unknown user-message input clears the current Telegram request association; while that turn is busy, Telegram steering may receive the existing local-console refusal. No replacement steering design is implemented. Request-bound file, Stop and reminder authority remain unchanged.

The local source-launch artifact is Telegram-only and has not been executed. This rollback does not install or reload source, modify settings, or establish live behavior. Fresh rollback validation passed typecheck, **194 tests** (none skipped), package dry-run **38 files** and diff checks. The full production audit covered all 22 modules: own configuration/locks/inbox and Telegram API effects, Git safeguards/metadata, ordinary Pi host APIs and own npm updates only. Credential-like upload protection is now a case-insensitive generic `credentials.json` / `*.credentials.json` rule, retaining the previously protected suffix while broadening privacy protection. Independent rollback review approved with the same **194 passing tests / 38 package files**. All 22 production modules and 30 test files, distributed guidance, manifests, workflows and the unexecuted local launcher were audited; no peer-extension awareness remains. The original busy-console guard is restored. Rollback preparation itself did not change loaded copies. Later user-reported-reload observations are scoped above; they do not independently verify a loaded source path.

## Validation checkpoints

Before the onboarding work, independent lifecycle validation passed typecheck and **167 tests**, package dry-run **33 files**, and diff checks. Earlier 145-test/31-file, 156-test/32-file and 164-test/33-file results are historical, not the latest lifecycle count. Onboarding changes add guide packaging, prerequisite metadata and pairing-render tests. Fresh combined Builder and independent Reviewer validation passed typecheck and **174 tests** (none skipped), pack dry-run **36 intended files**, and diff checks. Independent onboarding review approved; narrow-terminal pairing-render coverage is automated only, not a live pairing or reload test. The lockfile changes only the root Node engine metadata; dependency versions and Pi peer ranges are unchanged. Pairing-render tests are mocked, not a new live pairing run.

The extension's own Node floor is now **20.9.0**, reflecting `sharp` 0.35.4, but that is not a claim current Pi runs on Node 20. The examined Pi versions 0.84.4 (test SDK) and 0.87.1 require **Node 22.19.0 or later**. Use the requirements of your installed Pi as well. Standard Pi peer ranges remain `*`; they are not a tested compatibility matrix. No new OS/architecture support claim follows from metadata or mocks.

## 0.6.0 release checklist

Versioned candidate validation passed typecheck, **194 tests** (none skipped), audit with **zero vulnerabilities**, package dry-run **38 files**, and diff checks. Independent candidate review and release-commit CI are separate gates.

- Scope: breaking explicit Post/Draft/Edit/Activity API replacing `telegram_send`, Thinking lifecycle, omitted-reply reminder, requested layouts, optional skill, onboarding and transport isolation. See [migration](agent-tools.md#migration-from-050) and [release notes](../CHANGELOG.md#060).
- The owner authorized release **0.6.0** after final checks and CI. Candidate metadata is bumped; only the designated release actor may stage, commit, push and dispatch publication. Preparation does not install or reload.
- The owner confirmed saving npm Trusted Publisher owner **comput-sh**, repository **pi-telegram**, workflow **publish.yml**, blank environment. This confirms configuration only; publication and provenance from the transferred repository remain unverified.
- Before any authorized release, rerun typecheck/tests, audit, package allowlist and diff checks on the final versioned tree. Exclude local artifacts, hidden runtime state and credentials; never stage the whole worktree indiscriminately. Current source checks are evidence, not CI on a release commit.
- Single-session observations after the user-reported reload include direct Thinking handoff and the flows listed above. Two-session testing was explicitly declined and accepted as untested; host cancellation/adverse-network behavior remain pending. Do not label the original steering refusal fixed.
- After separate commit/push/publication authorization, verify workflow success, public registry version/tarball and exact commit/workflow provenance. Do not retry publication merely because registry visibility lags. Installation/reload and live verification are separate operations.

## Contributor checks

In a **terminal**, from the package checkout:

```bash
npm ci
npm run validate
npm audit --audit-level=moderate
npm run pack:check
git diff --check
```

Source testing is an advanced alternative, not beginner installation. Avoid loading both the npm and source copies: inspect enabled resources with terminal `pi config` first. In a controlled source-only setup, terminal `pi -e .` loads this checkout. Keep the process running; reload changes only through deliberate local Pi `/reload`. Do not infer installation, reload, live testing or publication from an automated check.

Implementation background: [architecture](https://github.com/comput-sh/pi-telegram/blob/main/docs/architecture.md) and [Rich Message evaluation](https://github.com/comput-sh/pi-telegram/blob/main/docs/telegram-rich-messages.md). These developer references are online repository links, not required for normal setup.
