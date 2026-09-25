# Posts, edits and formatting

Use `telegram_post` for permanent public replies and concise milestone updates. It always persists a new message and returns `messageRef`; it does not create/finalize a draft or change Working.

Tool: `telegram_post`
```json
{"message":"The tests passed. No files were changed."}
```

Rich Markdown is GitHub-Flavored Markdown-compatible where possible, not MarkdownV2. Choose headings, lists, tables, links, quotes, code, collapsible details, footnotes or LaTeX when helpful. Simple replies may remain simple. Do not promise identical support for every Markdown extension across clients.

Tool: `telegram_post`
```json
{"message":"## Validation\n\n| Check | Result |\n|---|---|\n| Types | Passed |\n| Tests | Passed |\n\nNo installation or reload was performed."}
```

To update a persisted non-button message, save the returned reference and supply full replacement Rich Markdown. Tool: `telegram_edit`
```json
{"messageRef":"RETURNED_MESSAGE_REF","message":"## Validation\n\nTypes, tests and review passed. No installation or reload was performed."}
```

Edit accepts only a reference returned by Post or Draft finalize on the same live connection, not a Telegram message ID, draft reference or another session's reference. Button messages cannot be edited. Only the 1,000 most recent persisted references are retained per connection; older references can expire. Editing does not affect Working or drafts. If no valid reference exists, do not invent one; explain the limit before posting a replacement that could duplicate an uncertain send.

Messages allow 32,768 characters (4,096 with buttons). Summarize or deliberately post separate sections rather than oversize tool arguments. Never expose hidden reasoning, raw logs/tool payloads or secrets. Use safe concise public outcomes; artifacts remain request-bound.

## Requested advanced formatting

Embedded buttons, compact tables and expandable quotes are available in [advanced layouts](advanced-layouts.md). Use them only for an explicit request or stated conversational preference, not automatic embellishment. Simple Markdown remains the default; the literal embedded-content subset cannot mix HTML formatting with buttons.

## One-time omitted-reply reminder

After an authenticated Telegram request actually begins processing and settles without a durable reply-tool attempt, Pi Telegram waits five seconds and may inject one static reminder into the same idle agent session. It does not send a Telegram response or forward transcript text. Only the latest processed inbound operation qualifies; console, scheduler, worker and proactive-output-only turns do not.

If reminded, send a brief honest answer, blocker or error summary via `telegram_post` (or another appropriate explicit reply tool). Do not repeat the underlying task, infer approval, or retry an uncertain delivery. A reminder is not new user authorization. Reminder turns cannot generate another reminder.

Post (including buttons), Draft finalize, Edit and file/photo attempts suppress this watchdog; preview-only draft actions, Working, typing and transport notices do not. Suppression is conservative even when an attempted reply fails local preflight or has uncertain delivery. Thus this detects omitted sends, not every missing reply or delivery failure. New input/work, queued messages, Stop, disconnect and session replacement suppress stale reminders; late results are credited only to their original request.

For continuing work, explicitly show/refresh Working separately and publish milestones frequently when meaningful; do not wait for a new incoming Telegram message. When done, clear activity explicitly. Proactive posts/edits use only this session's ready, verified assignment; no automatic setup or bot switching.
