import assert from "node:assert/strict";
import test from "node:test";
import { reconnectAssignedSession } from "../src/reconnect.ts";

test("reconnection retries exceptions and lease contention until success", async () => {
  // Keep a referenced timer alive while the production backoff uses unref timers.
  const keepAlive = setInterval(() => {}, 1000);
  try {
    let attempts = 0, notices = 0;
    await reconnectAssignedSession({ signal: new AbortController().signal, retryDelays: [1],
      attempt: async signal => { assert.equal(signal.aborted, false); attempts++; if (attempts === 1) throw new Error("network"); return attempts === 3; },
      onRetry: () => { notices++; },
    });
    assert.equal(attempts, 3);
    assert.equal(notices, 1);
  } finally { clearInterval(keepAlive); }
});

test("shutdown cancels backoff and never reconnects an old session", async () => {
  const controller = new AbortController();
  let attempts = 0;
  await reconnectAssignedSession({ signal: controller.signal, retryDelays: [1],
    attempt: async () => { attempts++; return false; }, onRetry: () => controller.abort(),
  });
  assert.equal(attempts, 1);
});
