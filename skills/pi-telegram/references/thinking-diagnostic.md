# Explicit native Thinking lifecycle

`telegram_thinking` deliberately controls a fixed generic `Thinking…` Rich block. It never accepts Thinking text or hidden reasoning and never mirrors agent/worker activity automatically. It is independent of Working and native typing. Start, local stop and answer handoff are separate actions.

## Normal path: start → direct handoff → update/finalize

Start returns an opaque `thinkingRef` after first API acceptance, not after the refresh window or a human response. Default refresh is **30 seconds**; integers 0–30 are accepted (0 one-shot). About four-second background refresh is bounded, never extended automatically. Tool: `telegram_thinking`
```json
{"action":"start"}
```

Save the returned reference; do not invent one. The examples below use placeholders to replace with actual returned references.

When the answer is ready, **handoff directly**: handoff already stops future refresh, so do not insert a redundant stop or artificial sleep. Provide the **full public answer snapshot**, not a delta or reasoning. It freezes future pulses and waits at most five seconds for positive completion of an issued pulse before sending an ordinary answer draft under a **new native draft ID**. It returns a real `draftRef`. There is **no native-expiry wait** and no automatic publication. Tool: `telegram_thinking`
```json
{"action":"handoff","thinkingRef":"<returned-thinkingRef>","message":"The checks passed. I’m preparing the final summary."}
```

Continue ordinary explicit draft operations with that returned reference. Tool: `telegram_draft`
```json
{"action":"update","draftRef":"<returned-draftRef>","message":"The checks passed. No files need further changes."}
```

Publish only when ready. Tool: `telegram_draft`
```json
{"action":"finalize","draftRef":"<returned-draftRef>"}
```

## Optional standalone stop

Use stop only when you want to end local refresh without handing off yet. It stops future refresh immediately without erasing the native preview. A previously issued bounded pulse may still settle; this is not a wait for the refresh window. Stop is idempotent for the current reference and retains it for later handoff. It is not a prerequisite for the normal direct-handoff path. Tool: `telegram_thinking`
```json
{"action":"stop","thinkingRef":"<returned-thinkingRef>"}
```

## Timing is not a visibility guarantee

`refreshSeconds` bounds scheduled refresh, **not exact visible duration**. Model/tool/API latency and the up-to-five-second positive prior-pulse barrier can contribute to elapsed time; these possibilities are not measured attribution of a particular observation. Do not add an artificial sleep or wait for native expiry before handoff. Only an explicitly requested natural-expiry comparison waits the native tail.

## Ownership, conflicts and uncertainty

Only initial/active refresh, in-flight pulses and pending handoff exclude other preview starts. Positively ended/stopped metadata **does not reserve the preview slot**. One latest reference is retained without an expiry timer; a new Thinking or ordinary answer-draft start invalidates it. Successful handoff, owner Stop and disconnect retire it too. Stale references reject instead of stopping newer work. Do not implicitly discard another active answer draft.

An uncertain pulse or handoff outcome fences preview operations until connection teardown; explicit stop or another start cannot bypass it. Persistent Post/Edit/Activity remain usable. Do not blindly replay uncertain delivery. Reconnection resets local state, **not** a remote-cancellation guarantee; no operation promises to retract already transmitted previews.

Local stop is not native clear: Rich previews can naturally remain up to 30 seconds after their last acceptance. Distinct native draft IDs replace rather than coexist. A deliberate handoff replaces the preview without waiting for that tail. Repeated identical Thinking payloads do not guarantee continuous visibility or renewal on every client. API acceptance is not visual proof.

## Isolated visual tests are a separate procedure

For an explicitly requested isolated test, first await a concise durable `telegram_post` experiment plan/ack in the **same authenticated request/turn**, then invoke Thinking. A prior turn’s acknowledgement does not supply this turn’s omitted-reply evidence. Neither Thinking nor handoff previews count as durable replies; do not disable the watchdog.

Coordinate quiet observation without Working, typing or unrelated answer-draft traffic, and ask the owner not to send new instructions during the window unless intentionally interrupting. For a **handoff test**, explicitly hand off when the answer is ready—no forced natural-expiry wait. Only a separately requested **natural-expiry/different-draft comparison** waits up to 30 seconds after the last preview. Do not clear/discard unrelated state just to prepare observation. Ask the owner what appeared; record API acceptance and visual confirmation separately.

Migration: the old no-argument diagnostic is gone. Use `{"action":"start"}`; its default is now 30 seconds, not a one-shot. Set `refreshSeconds:0` explicitly for one-shot start. There is no clear/finalize action on Thinking itself. This recipe authorizes neither live sends nor session launch, installation or reload.
