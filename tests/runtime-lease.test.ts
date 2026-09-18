import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { acquireTelegramRuntimeLease } from "../src/runtime-lease.ts";

test("a Telegram bot has only one live runtime lease", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-telegram-runtime-"));
  const env = { PI_TELEGRAM_SETTINGS: join(directory, "settings.json") };
  try {
    const first = await acquireTelegramRuntimeLease(
      "123456789",
      "session-one",
      "C:/project",
      { env },
    );
    assert.ok(first);
    assert.equal(
      await acquireTelegramRuntimeLease(
        "123456789",
        "session-one",
        "C:/project",
        { env },
      ),
      undefined,
    );
    await first.release();

    const second = await acquireTelegramRuntimeLease(
      "123456789",
      "session-two",
      "C:/project",
      { env },
    );
    assert.ok(second);
    await second.release();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("different Telegram bots can run concurrently", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-telegram-runtime-"));
  const env = { PI_TELEGRAM_SETTINGS: join(directory, "settings.json") };
  try {
    const first = await acquireTelegramRuntimeLease(
      "111111111",
      "session-one",
      "C:/project",
      { env },
    );
    const second = await acquireTelegramRuntimeLease(
      "222222222",
      "session-two",
      "C:/project",
      { env },
    );
    assert.ok(first);
    assert.ok(second);
    await Promise.all([first.release(), second.release()]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
