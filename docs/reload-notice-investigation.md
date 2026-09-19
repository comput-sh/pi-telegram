# Reload connection-notice investigation (0.2.5)

## Local fix implemented

The connection manager now sends its required notice before optional menu configuration. Menu setup runs in bounded background calls that abort with the connection; failures warn only for that same live connection. The unused startup branch lookup is removed. A matching initializing connection returns not-ready until the notice has been accepted. Regression tests in `tests/connection-notice.test.ts` exercise both slow menu methods, failure/cancellation, and readiness during a failed notice followed by retry.

These are local source changes only. The installed npm package has not been modified, and live reload behavior still requires verification after activation. The reproduction below describes the pre-fix implementation.

## Reproduced defect

Startup readiness depends on optional menu configuration. `ConnectionManager.connect()` currently performs:

1. Acquire the session's runtime lease and verify its saved assignment.
2. Assign `this.connection` and start polling (`getWebhookInfo`, initial `getUpdates`, then long polling).
3. Start the ownership monitor.
4. Await `configureCommandMenu()` (`setMyCommands`, then `setChatMenuButton`, each with a 20-second timeout; a chat-not-found fallback can add another call).
5. Look up the Git branch (up to three seconds), even though the startup formatter no longer shows it.
6. Send the Connected message (up to 20 seconds).
7. Mark connection setup complete and enable the update notice callback.

The entire startup/recovery attempt has a 30-second deadline. Two slow optional menu calls can exhaust it before step 6. Polling and a runtime lease can therefore be present while no connection notice has even been attempted. Recovery repeats the same sequence, so it cannot escape a consistently slow menu dependency. This is a demonstrated failure mechanism, not proof of the exact historical incident.

## Evidence

`artifacts/reload-notice-research.ts` uses the real connection manager, temporary test settings, and mocked Bot API responses (no real credentials/network):

```bash
node --import tsx artifacts/reload-notice-research.ts
```

The diagnostic aborts the attempt after menu setup starts, modelling the overall deadline without waiting 30 seconds. Both attempts start polling but make zero `sendMessage` calls. A control with responsive menu APIs sends the notice successfully. The script is intentionally a local artifact, not packaged production code.

## Additional weaknesses found

- `connect()` returns true for an already-present matching connection even while that connection may still be initializing. Presence/lease ownership is not a readiness or notification-delivery guarantee.
- A polling failure after successful startup disconnects and reports locally; the startup retry loop has already finished. This is a separate loss-of-connectivity risk, not evidence that a startup notice was skipped.
- Startup has no durable, sanitized phase/timing/delivery record. We cannot retrospectively distinguish a skipped send, API failure, accepted message, or client display issue for the user's earlier reloads.
- Telegram accepting a standalone diagnostic message proves delivery works at that moment; it does not establish that the startup path sent its notice.

## Recommended repair

- Send the required connection notice before optional menu configuration. Remove the unused startup Git branch lookup.
- Configure menus afterward as bounded, connection-bound background work, with a local warning on failure; do not disconnect a working bot because menu setup is slow.
- Distinguish initializing, polling, and ready states so repeated `connect()` calls cannot claim readiness prematurely.
- Add opt-in sanitized diagnostics for reload start/shutdown, attempt number, lease acquisition, phase durations, and notification success with Telegram message ID or sanitized error code. Never record tokens, token-bearing URLs, raw API payloads, captions, or model content.
- Test slow menu calls, send failures, cancellation, and repeated reloads. Then reproduce a real reload with instrumentation in the actual npm installation before claiming the original incident fixed.

The investigation initially changed no production code. The follow-up fix now changes local source as described above; no installed npm files were modified and no release was performed.
