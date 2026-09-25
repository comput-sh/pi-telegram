# Explicit activity and draft lifecycles

## Activity is independent

At work start, tool: `telegram_activity`
```json
{"action":"working"}
```

Refresh with the same action during long work before the 15-minute expiry. Execution, workers, posts, edits and drafts do not refresh it automatically. Use generic Working only; hidden reasoning never belongs in status. While waiting for workers, work continues. When finished or waiting for the user with no other work outstanding, tool: `telegram_activity`
```json
{"action":"clear"}
```

Clear removes Working, never shows Idle, and does not finalize/discard a draft or cancel any work. Always handle the draft separately.

## Draft operations

One draft may be active per connection. `start` rejects if another exists; explicitly finalize/discard it first. Full message input is at most 32,768 characters. Temporary plain previews are bounded to 4,096 with marked truncation; full Rich Markdown is retained for final persistence.

Start a preview, tool: `telegram_draft`
```json
{"action":"start","message":"## Findings\n\nChecking the tests."}
```

Save its returned `draftRef`. Replace the entire preview, tool: `telegram_draft`
```json
{"action":"update","draftRef":"RETURNED_DRAFT_REF","message":"## Findings\n\nTests passed; review is running."}
```

The replacement may be completely different text: no prefix matching, delta append, implicit post or inferred finalization. Always send the FULL replacement, not just new words or a manually truncated preview.

When verified, explicitly persist Rich Markdown and obtain a new `messageRef`, tool: `telegram_draft`
```json
{"action":"finalize","draftRef":"RETURNED_DRAFT_REF","message":"## Findings\n\nTests and review passed."}
```

Omit `message` on finalize only to persist the draft's current complete text. The draft reference is no longer usable. Clear activity independently when done. To abandon instead, tool: `telegram_draft`
```json
{"action":"discard","draftRef":"RETURNED_DRAFT_REF"}
```

For a generic Thinking placeholder before the answer, use [Thinking start → direct handoff](thinking-diagnostic.md), then continue normal update/finalize with its returned `draftRef`. Handoff already stops future Thinking refresh; no redundant stop, artificial sleep or native-expiry wait is needed. Standalone Thinking stop is optional local refresh control, not native erase.

Discard publishes nothing. Draft inactivity expires after 15 minutes without start/update, independently of Working refresh. Stop/disconnect/expiry invalidate drafts rather than publish unfinished text; Telegram previews can linger until they expire. A preview is not a delivered final answer. Post and Edit do not finalize drafts; Activity clear does not finalize them either. Use only references returned on this live connection. Uncertain delivery is not permission to blindly replay or invent another reference.
