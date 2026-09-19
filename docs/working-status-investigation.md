# Working-status investigation (pre-0.2.3)

## Implementation follow-up

The four approved fixes are now implemented locally: continuation activity, concurrent-tool tracking, visible activity/heartbeat after commentary, and queue acknowledgements. Regression tests cover these paths. The findings below describe the **pre-fix** implementation; the local diagnostic assertions intentionally captured that older behavior and are not the post-fix test suite. Live mobile/desktop visibility and degraded-network recovery remain unverified. The user authorized releasing these changes in 0.2.3 with live testing still pending.

## Conclusion

The status logic has reproducible lifecycle defects and deliberate UX limitations. These can explain inconsistent visibility, but no captured live Bot API/client trace establishes which caused the reported incident. The original investigation did not change production behavior; see the implementation follow-up above. Publication was initially paused for this investigation; the user subsequently authorized release.

## Confirmed findings

1. **Progress suppresses visible activity.** `src/telegram.ts` switches to a plain draft after public commentary. `setDraftActivity()` updates internal activity but returns without scheduling a write when `draft.plain` is true. `renderPlainDraft()` renders only text and U+2060 word-joiners, not activity. The refresh loop continues, but the user sees no visible heartbeat or working label. This is intentional in the current single-draft baseline, not a missing refresh timer.
2. **Continuation can run without a draft.** `src/request-routing.ts` sends every assistant `stop`/`length` response immediately. `sendRichMessage()` cancels the active draft. Only a new *user* `message_start` calls `beginRichDraft()`; assistant/turn/agent starts do not restore it. The installed Pi runtime can compact and retry a recoverable `length` response without a new user prompt. This leaves a valid request destination but no activity draft during continuation. Successful completion followed by automatic compaction can likewise have a visibility gap. Ordinary follow-ups with their own user start do recreate a draft.
3. **Overlapping tools are not tracked.** Every `tool_execution_end` resets activity to Thinking, regardless of other active tools. Before commentary this can display Thinking while a tool is still running; after commentary the incorrect state is invisible. Tool-call IDs or an active-tool set are needed, not a single start/end toggle.
4. **Queued inputs have no acknowledgement.** Enqueueing the authenticated request receipt does not create a draft or send a waiting message. Drafts start when Pi processes the user message. That avoids overwriting active work, but leaves the sender without queue feedback.
5. **Error/abort outcomes may end silently.** Textless assistant endings return early. `agent_settled` retries only a completed `stop`/`length` answer, then cancels the draft. There is no dedicated public failed/cancelled outcome message in response routing. Hidden model/tool error details must not be used as a substitute for a safe generic outcome.

## Confirmed mechanisms, live effects still uncertain

- Five-second refreshes already exist. They change only invisible U+2060 characters. Earlier controlled notes in `docs/telegram-draft-ux-baseline.md` record mobile expiry around 8–15 seconds, unreliable identical refreshes, and a working *visible* heartbeat. The later production baseline switched to invisible changes. Whether current Telegram clients normalize/ignore those changes needs a real-client test; mock HTTP success cannot establish that.
- Draft writes are serialized and can wait up to 20 seconds per request; the refresh loop waits for a write to complete before its next five-second sleep. Therefore five seconds is not a guaranteed delivery interval during slow/failing requests. This can exceed the previously observed mobile draft lifetime.
- Background failures already produce rate-limited **local** warnings and future refresh attempts. There is no Telegram-visible degraded-status notice or bounded draft-recreation policy. Do not report that recovery is entirely absent.
- Streaming depends on recognized commentary/final-answer phase metadata. Providers lacking it may not show text until `message_end`, though initial Thinking should still exist. This is not by itself evidence of lost request routing.
- Once the agent genuinely settles, clearing activity is correct—even if its final text says “I’ll investigate.” Such wording does not schedule more work. A missing indicator after an actual completed response is not automatically a bug.

## Reproduction

A local diagnostic at `artifacts/status-research.ts` uses the real response router and connection with mocked fetch responses and no credentials/live Telegram traffic. Run:

```bash
node --import tsx artifacts/status-research.ts
```

It confirms:

- enqueue alone sends no waiting acknowledgement;
- finishing one of two tools resets the native activity to Thinking;
- commentary refreshes change bytes but not visible text;
- after `length` completion, agent/turn/assistant/tool continuation creates no draft while the request destination remains active.

This script is a local research artifact, not included in the npm package. Existing tests validate payloads and the deliberate no-return-to-Thinking behavior; they do not prove mobile visibility or cover the continuation gap.

## Recommended fix scope

- Separate request activity from the lifetime of an individual response preview. Restore generic activity for authenticated continuation; stop it only on true settlement, cancellation or disconnect. Preserve separate permanent Rich Markdown responses.
- Preserve the single evolving draft after commentary, but append a compact visible working/tool label and heartbeat. Do not alternate commentary away or revive the rejected dual-element/typing experiments.
- Track overlapping tools by call ID and clear that state at appropriate lifecycle boundaries.
- Acknowledge queued requests without claiming work has started or replacing the active task's status.
- Provide safe generic failure/cancellation outcomes, without hidden reasoning, raw tool errors or credentials.
- Add controlled retry/recovery and sanitized local diagnostics (lifecycle transitions, API method, duration, outcome; never token-bearing URLs or payloads).
- Add deterministic lifecycle regression tests, then test long tools, queued follow-ups, interrupted requests, continuation/compaction, and connection failures on actual desktop/mobile Telegram clients before publication.
