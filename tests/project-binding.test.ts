import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  assertBindingMatchesBot,
  deriveBotUsername,
  getProjectBindingPath,
  loadProjectBinding,
  normalizeBotUsername,
  saveProjectBinding,
} from "../src/project-binding.ts";

test("deriveBotUsername uses a configurable public-package prefix", () => {
  assert.equal(deriveBotUsername("TelegramPi"), "piTelegramPiBot");
  assert.equal(deriveBotUsername("TelegramPi", "cpu"), "cpuTelegramPiBot");
  const long = deriveBotUsername(
    "A very long project folder name that exceeds Telegram limits",
  );
  assert.equal(long.length, 32);
  assert.match(long, /^pi[A-Za-z0-9]+Bot$/);
});

test("normalizeBotUsername accepts an optional at sign and rejects invalid names", () => {
  assert.equal(normalizeBotUsername(" @cpuCustomBot "), "cpuCustomBot");
  assert.throws(() => normalizeBotUsername("not-valid"), /must be 5 to 32/);
  assert.throws(() => normalizeBotUsername("cpuCustom"), /end with Bot/);
});

test("project binding is persisted without credentials and can be reloaded", async () => {
  const directory = await mkdtemp(join(tmpdir(), "telegrampi-binding-"));
  try {
    const saved = await saveProjectBinding(directory, {
      projectKey: "sample-12345678",
      botUsername: "cpuSampleBot",
    });
    assert.deepEqual(saved, {
      version: 1,
      projectKey: "sample-12345678",
      botUsername: "cpuSampleBot",
    });
    assert.deepEqual(await loadProjectBinding(directory), saved);
    const text = await readFile(getProjectBindingPath(directory), "utf8");
    assert.doesNotMatch(text, /token|apiKey|function/i);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("an accepted pending username can update the project binding", async () => {
  const directory = await mkdtemp(join(tmpdir(), "telegrampi-binding-"));
  try {
    await saveProjectBinding(directory, {
      projectKey: "sample-12345678",
      botUsername: "cpuSampleBot",
    });
    await assert.rejects(
      () =>
        saveProjectBinding(directory, {
          projectKey: "sample-12345678",
          botUsername: "computSampleBot",
        }),
      /already points to @cpuSampleBot/,
    );

    const updated = await saveProjectBinding(
      directory,
      {
        projectKey: "sample-12345678",
        botUsername: "computSampleBot",
      },
      { allowUsernameUpdate: true },
    );
    assert.equal(updated.botUsername, "computSampleBot");
    assert.deepEqual(await loadProjectBinding(directory), updated);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("invalid and mismatched project bindings fail clearly", async () => {
  const directory = await mkdtemp(join(tmpdir(), "telegrampi-binding-"));
  try {
    await writeFile(getProjectBindingPath(directory), "{}\n", "utf8");
    await assert.rejects(() => loadProjectBinding(directory), /is invalid/);

    assert.throws(
      () =>
        assertBindingMatchesBot(
          {
            version: 1,
            projectKey: "sample-12345678",
            botUsername: "cpuSampleBot",
          },
          {
            projectKey: "sample-12345678",
            botUsername: "cpuOtherBot",
          },
        ),
      /expects @cpuSampleBot/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
