# Opt-in native typing diagnostic

Use `telegram_chat_action` only when the user explicitly asks to test Telegram's native typing display. It is separate from the removable Working message controlled by `telegram_activity`, not its replacement. Do not enable automatic tool/worker activity mirroring.

The action is fixed to `typing`. Default `refreshSeconds: 0` sends one pulse. Tool: `telegram_chat_action`
```json
{"action":"typing"}
```

For a requested observation window, `refreshSeconds` may be an integer from 0 to 30. Tool: `telegram_chat_action`
```json
{"action":"typing","refreshSeconds":12}
```

The tool returns after first API acceptance, not after the window or a human response. Refresh runs about every four seconds in a bounded, connection-scoped background loop, independent of polling and Post/Draft/Edit/Activity. One loop per connection; a new call supersedes the previous one. Stop/disconnect/caller cancellation stops refreshing. No dependency or process orchestration is needed.

Telegram documents typing as lasting at most five seconds per pulse, and says a bot message clears it. There is no native clear action: a tail can remain after refresh stops. The requested refresh window is not a guarantee of continuous visible typing. Successful API acceptance does not prove any particular client displayed it.

## Controlled comparison, only after coordinated activation

1. Agree the observation window with the owner before the test. In the **same authenticated test request/turn**, first use `telegram_post` for a concise durable experiment plan/acknowledgement and await acceptance, **then** invoke typing. This explicit reply supplies omitted-reply watchdog evidence; a prior turn's acknowledgement does not. Never disable the watchdog or count typing as a durable reply. First test typing alone: arrange no posts, drafts or Working refresh traffic during observation. Do not automatically discard an active draft or clear an unrelated activity indicator just to prepare the test; coordinate first.
2. Call `telegram_chat_action`, then avoid sending Telegram text during the refresh window and natural expiry tail (up to five seconds after the last pulse). The agent and inbound polling remain responsive; this quiet period is a test procedure, not a blocking transport gate. Do not post an immediate success acknowledgement that could erase the indicator. Ask the owner to observe without sending new instructions during the window unless intentionally interrupting.
3. Ask the owner what appeared after observation, or receive their ordinary follow-up. Record API acceptance and visual confirmation separately.
4. Only if separately authorized, compare typing with an explicit draft. Use Draft start/update/finalize/discard deliberately and Working independently; do not infer either from typing.

Do not claim native typing is reliable, clears Working, finalizes drafts, stops workers, or was tested live based on mock tests. Do not blindly replay uncertain delivery. This recipe itself neither launches a session nor authorizes installation/reload or a live send.
