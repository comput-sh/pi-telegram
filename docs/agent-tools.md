# 0.6.0 agent tools and communication contracts

[Back to onboarding](../README.md) · [User guide](user-guide.md) · [Source evidence](development-status.md)

**Documentation for 0.6.0.** This reference explains the explicit tools and optional skill for agents and tool authors; it is not an extra step in beginner setup. Upgrading from 0.5.0 requires the [migration](#migration-from-050) below.

## Optional usage skill

The local package now bundles `skills/pi-telegram/SKILL.md`, declared through `pi.skills`, with focused recipes for conversation/formatting, activity/drafts, buttons, files/photos, and asynchronous progress. Pi discovers the description; full content loads on demand, not automatically for every Telegram turn. When skill commands are enabled, `/skill:pi-telegram` explicitly loads it. Package resource filters can disable it. The extension's tool descriptions and prompt guidelines remain the mandatory contract; the skill adds no tools or permissions.

The skill and explicit messaging API below target 0.6.0. They do not exist in 0.5.0; update the package and deliberately reload the session to activate the new contracts.

**Asynchronous boundary:** Poll/authenticate/push inbound to Pi and continue without model/human-response waits. Input admission and guarded Stop requests are independent of pending questions, Working, drafts and outbound delivery; bounded control UI cleanup is supervised separately. Agents independently post/edit/draft/show activity without prior incoming text. Explicit tools await bounded API delivery, not an answer; ordering, rate limits and file/Stop provenance safeguards still apply. Ordinary text and `/steer` remain admitted during attachment download, subject to console-task protection. Additional files and question-button selections are rejected with a request to try again after the download finishes.

## Explicit asynchronous messaging

**Breaking in 0.6.0:** the generic `telegram_send` tool is removed. Choose the operation explicitly; there is no status-omission or prefix inference. Ordinary commentary/final text is still never forwarded automatically.

| Tool | Contract |
|---|---|
| `telegram_post` | Persist exactly one of Rich Markdown `message` (up to 32,768 characters; 4,096 with keyboard buttons) or requested embedded-button `content` (literal text, 4,096 derived characters). Content forbids top-level buttons. Returns connection-scoped `messageRef`; does not affect drafts or Working. |
| `telegram_draft` | `start` with full `message`; `update` with returned `draftRef` and full replacement; `finalize` with `draftRef` and optional full final text, returning `messageRef`; `discard` with `draftRef`, publishing nothing. |
| `telegram_edit` | Full replacement `message` for a returned non-button `messageRef`. No draft or activity changes. |
| `telegram_activity` | Explicit `action: "working"` or `"clear"`; independent of messages and drafts. Clear is not cancellation or draft finalization. |

Draft start/update always take full replacement text; the replacement need not extend earlier text. One active draft per connection; start rejects if one exists. Plain previews are bounded to 4,096 characters with marked truncation; the full Rich Markdown is retained for final persistence. Stop/disconnect/expiry discard pending drafts, not publish unfinished text.

Post can include 1–8 distinct `label`/`reply` buttons (64/1,024 characters respectively). Button messages are persisted and not editable; selections are authenticated follow-ups. Draft refs and persisted refs are different opaque values scoped to the live connection. Never invent refs, use Telegram message IDs, or reuse refs across reconnects. Uncertain delivery must not be blindly replayed.

At work start, call `telegram_activity` with `{"action":"working"}`. Publish concise milestones through `telegram_post` independently. Refresh Working before 15-minute expiry during long/delegated work. When done or waiting for the user with no ongoing work, call `telegram_activity` with `{"action":"clear"}` and separately finalize/discard any active draft. No Idle label or automatic execution/worker mirroring exists.

Post/Draft/Edit/Activity target only this session's ready, verified bot, including proactive console/scheduled work without inbound text. No automatic setup or bot switching. Files/photos retain their request-bound safeguards. Calls await API delivery, never model or human responses.

Only the paired owner can select an option. The selected question, label and reply re-enter the same connection's authenticated input path as a normal follow-up, never as a steering command. Sending the question does not grant approval or block the tool waiting for an answer.

Only one question is active per connection. A new question, typed answer, stop, disconnect or 15-minute expiry invalidates it; keyboard removal is best-effort if Telegram is unreachable. Duplicate and stale clicks are rejected. You can always type an answer instead. Button labels must be distinct. Replies or disconnects during a slow question send prevent its buttons from becoming active afterward. If routing a selection fails, Telegram reports uncertain delivery without automatically retrying it. Buttons do not replace local setup/security confirmation dialogs. The owner confirmed a single-session button follow-up repeating the draft test; this does not establish every callback race or two-session behavior.

## Request-driven advanced layouts

Advanced layouts are discoverable, but used only when explicitly requested or specified as a conversational preference—not automatically and not through an enable/disable mode. Ordinary Rich Markdown and keyboard choices remain unchanged.

`telegram_post` may use `content` instead of `message`: 1–16 `paragraph` or `button_row` blocks. Paragraph `parts` (1–32) are `{type:"text",text}` or `{type:"button",label,reply}`; rows contain `buttons` with label/reply choices. Total choices are 1–8 across all blocks, with distinct nonblank labels up to64 and replies up to1024 characters. The derived visible question text including labels and separators must fit4096 characters. This subset is literal text, not Markdown/HTML, and cannot coexist with `message` or top-level keyboard `buttons`. Arbitrary native blocks/callback IDs/styles/media/URL actions are not accepted.

Both layouts share one pending question and the same owner/nonce/message/one-use rules. Button posts remain immutable through Edit; inactive embedded visuals are best-effort cleanup, not proof of authority. Tool success is never approval and uncertain delivery must not be blindly replayed.

Requested compact tables use existing `message` HTML `<table compact><tr><td>Cell</td></tr></table>`; expandable quotes use `<blockquote expandable>Summary<br>Details</blockquote>`. HTML contents need HTML inline markup, not Markdown. No transport flag or renderer change is required. Mixed formatted HTML and embedded content is outside the initial subset. See [annotated examples](../skills/pi-telegram/references/advanced-layouts.md). The owner observed inline/row button clicks and disabled states, compact tables and expandable quotes on an updated client with prior loaded source; later user-reported-reload observations also confirmed inline callback placement/disabled choices and compact tables/expandable quotes. Loaded path was not independently verified; row-callback testing was not repeated.

## One-time omitted-reply reminder

Only a real Telegram inbound receipt that is authenticated and actually begins processing can arm this reminder. After that latest operation genuinely settles, a five-second grace period allows a late reply. If no persistent reply-tool attempt was made, the extension may inject one static reminder asking the agent for a brief explicit Telegram answer, blocker or error summary. It never forwards the transcript or generates a user response itself, retries the task, or grants approval.

Post/buttons, Draft finalize, Edit and file/photo tool attempts count; preview draft operations, Working, native typing and transport notices do not. All executed reply attempts suppress conservatively, including preflight failures and uncertain delivery: this repairs omitted calls, **not delivery failures**, and does not encourage blind replay. New input/work, pending host messages, Stop/disconnect/replacement or changed assignment suppress the reminder. The idle-only synthetic receipt is same-connection, nonrecursive and single-budget; no console/scheduler/worker/proactive-only watchdog. Delivery/admission remains best effort, not a guaranteed answer.

## Native typing diagnostic (opt-in)

`telegram_chat_action` tests Telegram's native typing display independently of Working, posts and drafts. Arguments: `{"action":"typing","refreshSeconds":12}`; omit `refreshSeconds` (default 0) for one pulse, or use an integer 0–30 for bounded refresh about every four seconds. It returns after the first API acceptance, with refresh supervised in the background. New calls supersede old refresh loops; Stop/disconnect/caller cancellation stop refreshing.

Telegram says typing lasts at most five seconds per pulse and a bot message clears it. There is no clear action, no guaranteed client visibility, and no automatic activity mirroring. This is diagnostic only: compare typing alone first, then with drafts only if separately authorized, avoiding immediate bot replies during the observation window. After source activation, the owner reported that an isolated 12-second typing test looked good; other clients/combinations are not thereby verified. See the optional [typing recipe](../skills/pi-telegram/references/typing-diagnostic.md).

## Explicit Thinking lifecycle

`telegram_thinking` uses a fixed generic in-chat `Thinking…` Rich block—never custom Thinking text or hidden reasoning:

- `{"action":"start"}` returns `thinkingRef` after first API acceptance. Optional integer `refreshSeconds` is 0–30, **default 30**; 0 is one-shot. Background refresh is bounded, not a duration wait.
- Normally go directly to `{"action":"handoff","thinkingRef":"…","message":"Full public answer snapshot"}` when the answer is ready. Handoff already stops future refresh and requires positive prior-pulse completion within five seconds, then replaces Thinking with an ordinary answer draft under a new native ID and returns `draftRef`. Continue with explicit `telegram_draft` update/finalize. **No redundant stop, artificial sleep or native-expiry wait is required.** Nothing is automatically published.
- Optional standalone `{"action":"stop","thinkingRef":"…"}` ends future refresh when you do not want to hand off yet, retains the current ref idempotently, and does **not** erase the native preview. An already issued bounded pulse may still settle.

`refreshSeconds` bounds scheduled refresh, not exact visible duration. Model/tool/API latency and the up-to-five-second positive-pulse barrier can contribute to elapsed time; this does not attribute any observed duration to a measured cause.

Only active/initial/in-flight/pending-handoff state excludes other preview starts. Confirmed-ended/stopped metadata does not reserve a slot: one latest ref is retained without an expiry timer until supersession, successful handoff, owner Stop or disconnect. A new Thinking/answer-draft start invalidates old metadata. Uncertain pulse/handoff outcomes fence previews until connection teardown; stop or new starts cannot bypass this. Post/Edit/Activity remain available. Reconnection resets local state, not a remote-cancellation guarantee.

Native previews can linger up to 30 seconds after the last accepted pulse; different IDs replace rather than coexist, and identical refresh does not guarantee client visibility. Natural-expiry waits belong only to separately requested isolated comparisons, not normal explicit handoff. For isolated tests, first await a durable Post plan/ack in the same authenticated request/turn, then keep observation quiet; previews do not suppress the omitted-reply watchdog. See the [lifecycle recipe](../skills/pi-telegram/references/thinking-diagnostic.md). Earlier tests included explicit stop before handoff; after a user-reported reload the owner also confirmed direct start → handoff → update → finalize as “perfect”. This is single-session evidence without independently verified loaded path.

Migration from the earlier unreleased diagnostic: no-argument calls are no longer valid; use `action:"start"`. The default changed from one-shot to 30-second bounded refresh. Working, typing and other explicit tools are unchanged.

## Migration from 0.5.0

The historical generic send tool and its prefix/status-omission rules are removed in 0.6.0. Replace combined message/status calls with explicit Post or Draft actions plus independent Activity calls. Replace `{}` finalization with Draft finalize and Activity clear. Persisted edits require the returned `messageRef`, never inferred matching text. No compatibility adapter is exposed. Historical release behavior remains documented in [CHANGELOG.md](../CHANGELOG.md). The [scoped single-session source observations](development-status.md) do not establish two-session, slow-network or host-cancellation behavior. The owner declined two-session testing and accepted that untested release limitation.
