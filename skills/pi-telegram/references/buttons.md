# Choices without blocking

Use `telegram_post` with a message (at most 4,096 characters) and 1–8 distinct label/reply options. Labels allow 64 characters; replies allow 1,024. Labels and replies must describe the same visible choice. Buttons persist, never draft.

Tool: `telegram_post`
```json
{"message":"Which review should I do?","buttons":[{"label":"Security","reply":"Review security boundaries."},{"label":"Performance","reply":"Review performance."}]}
```

Post returns after API delivery, not after the owner chooses. It never changes Working: when waiting for the user with no work ongoing, separately clear activity. Continue independent work if authorized; keep activity refreshed when work continues.

Success means sent, not approved. Wait for an authenticated follow-up before acting on a choice. Owner-only, one-use, connection-bound selections enter Pi as follow-ups, not steering. They do not bypass local security/setup confirmations. Posted button messages cannot be edited with `telegram_edit`.

For explicitly requested embedded buttons within text or button rows, see [advanced layouts](advanced-layouts.md). Ordinary message plus keyboard buttons remains the default. Embedded `content` is exclusive of `message` and top-level `buttons`; its text is literal, not Markdown/HTML. It adds no approval authority or enable mode.

One question can be active per connection across both keyboard and embedded layouts. Replacement, typed answer, Stop, disconnect and 15-minute expiry invalidate choices; UI cleanup is best-effort and does not gate input admission. Do not count stale/duplicate clicks as consent. Uncertain delivery must not cause blind replay of a question or selected operation.
