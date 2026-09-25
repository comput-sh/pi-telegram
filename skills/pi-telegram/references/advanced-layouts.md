# Request-driven advanced layouts

These capabilities are available through `telegram_post`, but use them **only when the user explicitly requests them or states a conversational layout preference**. Do not automatically embellish ordinary replies. There is no enable/disable mode and no extra approval authority. Keep simple Rich Markdown and ordinary [keyboard choices](buttons.md) as the default.

## Embedded action buttons

Use `content` instead of `message` to place choices inside literal text paragraphs or in button rows. This initial subset is **plain text only**: no Markdown/HTML interpretation, styled text, URLs as actions, media or raw Telegram blocks. Do not combine `content` with `message` or top-level `buttons`. If the user wants formatted HTML and embedded controls together, explain that this subset cannot combine them; offer ordinary formatted `message` with existing keyboard buttons instead.

For a requested embedded-choice layout, tool: `telegram_post`
```json
{"content":[{"type":"paragraph","parts":[{"type":"text","text":"Would you like me to "},{"type":"button","label":"inspect the README","reply":"Inspect the README only; do not change files."},{"type":"text","text":" first?"}]},{"type":"button_row","buttons":[{"label":"Wait","reply":"Wait for my next instruction."}]}]}
```

Limits: 1–16 blocks, 1–32 parts per paragraph, 1–8 buttons **across the entire message**, distinct nonblank labels up to 64 characters and nonblank replies up to 1,024. Derived visible question text, including labels, row separators and block separators, must fit 4,096 characters. Text parts concatenate literally: include spaces where needed. Use only `paragraph` with text/button parts or `button_row` with label/reply choices; never invent callback IDs, payload fields or approval flags.

Embedded and keyboard layouts share **one pending question per connection**. Both return a persisted `messageRef`, but button messages are not editable through `telegram_edit`. Wait for the authenticated one-use follow-up before acting; sending a layout is not consent. Replacement, typed reply, Stop/disconnect and expiry retire callbacks. Disabling old embedded visuals is best effort: a stale-looking button is not live authority. No automatic retry after uncertain delivery, draft finalization or Working change.

## Compact tables

Use the unchanged Rich Markdown `message` field with verified HTML syntax when the user asks for a compact table. Inside the HTML element use **HTML inline formatting**, not Markdown markers. Tool: `telegram_post`
```json
{"message":"<table compact><tr><td><b>Option</b></td><td><b>Use</b></td></tr><tr><td>Inspect</td><td>Read only</td></tr><tr><td>Wait</td><td>No action</td></tr></table>"}
```

## Expandable quotes

For a requested expandable quote, use the unchanged `message` field. Tool: `telegram_post`
```json
{"message":"<blockquote expandable><b>Review summary</b><br>No files changed.<br>Further checks are available on request.</blockquote>"}
```

Escape literal HTML-sensitive characters in text as appropriate. These examples add no transport flags or new renderer mode. They do not authorize hidden reasoning, private prompts or raw tool results. Native client appearance remains separate from API acceptance; no live advanced-layout observation is implied by these recipes.
