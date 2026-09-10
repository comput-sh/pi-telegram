# Telegram draft UX baseline

This document records the known-good Telegram response lifecycle before experimenting with moving activity outside the response draft.

## Known-good hybrid lifecycle

1. On accepted Telegram input, create one `sendRichMessageDraft` using a stable non-zero `draft_id`.
2. The initial payload contains only a native `InputRichBlockThinking` block with an `AIActions` custom emoji and `can_stop: false`.
3. As soon as tool activity, completed public commentary, or final-answer text exists, switch the same `draft_id` to plain `sendMessageDraft`.
4. The plain draft contains, in order:
   - completed public commentary accumulated atomically;
   - the currently streaming final answer, when present;
   - a generic Unicode activity label and visibly changing heartbeat.
5. Public commentary is never token-streamed. Each commentary assistant message is appended only after its `message_end` with `stopReason: "toolUse"`.
6. Only text identified as Pi `final_answer` is streamed. OpenAI Responses exposes the phase early through `stopReason: "stop"`; completed text also carries `textSignature.phase: "final_answer"`.
7. Plain draft writes are coalesced at 1.5 seconds. A visible heartbeat changes every five seconds because Telegram clients ignore identical refresh payloads.
8. Tool arguments, tool results, prompts, and hidden reasoning are never included. Tool events only select generic statuses such as reading, searching, browsing, running commands, and editing.
9. Plain previews are limited to 4,096 characters and visibly marked if truncated. The permanent response retains the 32,768-character Rich Markdown limit.
10. At each completed assistant `message_end` (`stop` or `length`), cancel local draft refresh and persist that response through `sendRichMessage` as its own normal unquoted Rich Markdown message. `agent_settled` is fallback cleanup.
11. Route ordinary Telegram messages as `followUp`. Strip a leading `!` and route it as explicit `steer`; interpret `!!` as an escaped literal bang. Either delivery starts immediately while Pi is idle, and draft creation follows Pi's user-message lifecycle.

## Controlled-test findings

- Permanent `sendRichMessage` renders correctly on desktop and mobile.
- Plain `sendMessageDraft` renders complete text and incremental updates correctly on desktop and mobile.
- Both official and alternative mobile clients animate `sendRichMessageDraft` text character by character too slowly, even when the complete payload is sent once.
- The slow Rich Draft behavior occurs with Markdown, explicit paragraph blocks, stable IDs, and rotating IDs. Desktop behavior is acceptable.
- Switching one stable draft ID from an initial Rich Thinking block to plain `sendMessageDraft` works cleanly on desktop and mobile.
- Mobile expires an inactive draft after roughly 8–15 seconds; desktop retains it longer.
- Repeating an identical payload does not reliably refresh draft visibility. A visibly changing five-second heartbeat does.
- Custom-emoji entities in plain `sendMessageDraft` display only the ordinary fallback emoji in tested clients.
- The full hybrid lifecycle—Rich Thinking, atomic commentary, plain final streaming, permanent Rich Markdown—was visually approved on mobile.

## Experimental alternative

The proposed experiment removes activity text from the evolving response draft and uses `sendChatAction("typing")` as Telegram's external activity indicator. The response draft then contains only public commentary and final-answer text.

Trade-offs to evaluate:

- cleaner response draft;
- no native `AIActions` illustration after the initial state;
- no detailed reading/searching/editing labels;
- `sendChatAction` may disappear whenever a draft update is sent and may need frequent refresh;
- keeping an unchanged commentary draft alive may still require a content-changing heartbeat.

## Experiment result

Telegram accepted `sendChatAction("typing")`, but the tested clients displayed no useful external thinking or working indicator during the lifecycle test. The alternative was rejected.

## Rejected alternating-activity experiment

A synthetic test alternated one draft between native activity and plain commentary. Artificial delays made it look acceptable, but real Pi tool calls replaced commentary almost immediately, causing comments to flash briefly and never remain readable. The design was rejected.

## Previous dual-element lifecycle

The previously accepted controlled test used two Telegram elements while work was underway:

1. Keep native Rich Thinking/tool activity in one draft and refresh it with a changing five-second heartbeat.
2. Send the first completed public commentary silently as one ordinary message, then rotate the activity draft ID once so activity appears below it.
3. Edit that same commentary message to contain only the latest completed public comment.
4. When `final_answer` begins, delete the temporary commentary message and replace the activity draft with plain streamed final text.
5. Persist the completed answer as a normal Rich Markdown message.

This sequence was visually approved in a controlled mobile test, but real-session feedback showed that the separate commentary message was not reliably visible and the lower activity draft dominated the experience with generic Thinking. It is no longer the production behavior.

## Current single evolving draft lifecycle

1. Create one native Rich Thinking/activity draft when Telegram input starts.
2. Allow generic tool activity to update it only until public commentary exists.
3. On the first public `commentary` delta, replace the same stable draft ID with a plain `sendMessageDraft` containing a whitespace-flattened one-line progress update.
4. Coalesce further commentary at 1.5 seconds and replace the same line as it evolves. Never switch back to generic activity after progress is visible.
5. Add an invisibly changing five-second heartbeat to both Rich and plain payloads so mobile clients retain the draft.
6. When `final_answer` begins, replace the same draft with the streamed final text.
7. Persist the completed response as a normal Rich Markdown message.

The injected Telegram transport notice asks the model for concise single-line public updates at meaningful milestones. Hidden reasoning remains private.
