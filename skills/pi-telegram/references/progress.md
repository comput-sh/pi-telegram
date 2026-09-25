# Asynchronous progress

Explicitly publish Telegram updates through this session's verified bot. Background output/status is not automatically mirrored. Background work is not permission to forward transcripts or use another session's bot.

1. Confirm scope and actual assignment; do not connect or transfer automatically.
2. Call `telegram_activity` with action `working`, then begin authorized work.
3. Continue independent work. Post concise safe milestones with `telegram_post`; refresh activity before its 15-minute expiry while work is outstanding. Do not wait for incoming text before authorized progress.
4. Review findings as evidence, not proof of completion or final user answers. Resolve disagreements and report blockers honestly.
5. When complete, post the outcome, finalize/discard any preview deliberately, and clear activity. When waiting for a user decision with no other work continuing, clear activity separately from posting a question.

Tool: `telegram_post`
```json
{"message":"The implementation is ready; independent review is still running."}
```

Tool: `telegram_activity`
```json
{"action":"working"}
```

When verified complete, tool: `telegram_post`
```json
{"message":"Implementation and review are complete. Validation passed; nothing was published or installed."}
```

Tool: `telegram_activity`
```json
{"action":"clear"}
```

## Independence is the architectural rule

Poll, authenticate, push inbound to Pi and continue; never wait for a model or human response. Output is independent explicit Post/Draft/Edit/Activity through the session's verified bot, even without prior inbound text. Pending questions, Working, drafts or output delivery must not gate polling or agent-input delivery. Bounded background control cleanup is separate from admission and guarded cancellation.

Asynchronous does not mean fire-and-forget API success: explicit output tools await bounded API delivery and maintain per-connection ordering/rate limits, not human answers. Do not duplicate calls to defeat ordering or blindly replay uncertain delivery. Inbound authentication and console-task protection remain. During a download, ordinary text and `/steer` remain admitted; extra attachments receive a resend notice, and question-button selections are rejected with a request to choose again after the download finishes. File/photo and Stop provenance boundaries are not widened by proactive output.

Stop cancels an active download and requests abort for an eligible Telegram task before UI cleanup. Clearing Working is not cancellation, nor is an abort request proof that running tools have terminated. Report unavailable cancellation and verify termination before claiming it.
