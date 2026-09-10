import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  getGlobalSettingsPath,
  getProjectSettingsPath,
  loadGlobalSettings,
  loadProjectSettings,
  normalizeBotUsername,
  saveGlobalSettings,
  saveProjectSettings,
} from "../src/config.ts";

test("global manual mode is saved without manager credentials", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-telegram-extension-config-"));
  const path = join(directory, "settings.json");
  const env = { PI_TELEGRAM_EXTENSION_SETTINGS: path };
  try {
    await saveGlobalSettings({ version: 1, provisioningMode: "manual" }, env);
    assert.equal(getGlobalSettingsPath(env), path);
    assert.deepEqual(await loadGlobalSettings(env), {
      version: 1,
      provisioningMode: "manual",
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("global manager identity and token are stored together in settings", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-telegram-extension-config-"));
  const path = join(directory, "settings.json");
  const env = { PI_TELEGRAM_EXTENSION_SETTINGS: path };
  try {
    const settings = {
      version: 1 as const,
      provisioningMode: "manager" as const,
      manager: {
        id: "100200300",
        username: "ExampleManagerBot",
        token: "test-manager-token",
        updateOffset: 42,
      },
    };
    await saveGlobalSettings(settings, env);
    assert.deepEqual(await loadGlobalSettings(env), settings);

    const updated = {
      ...settings,
      manager: { ...settings.manager, updateOffset: 43 },
    };
    await saveGlobalSettings(updated, env);
    assert.deepEqual(await loadGlobalSettings(env), updated);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("project bot settings are private project-local state", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-telegram-extension-project-"));
  try {
    const settings = {
      version: 1 as const,
      id: "987654321",
      username: "ChosenProjectBot",
      token: "test-project-token",
      ownerUserId: "123456789",
      managed: false,
    };
    await saveProjectSettings(directory, settings);
    assert.equal(
      getProjectSettingsPath(directory),
      join(directory, ".pi", "pi-telegram-extension.local.json"),
    );
    assert.deepEqual(await loadProjectSettings(directory), settings);
    const savedFile = JSON.parse(
      await readFile(getProjectSettingsPath(directory), "utf8"),
    );
    assert.deepEqual(savedFile, {
      version: 1,
      bot: {
        id: "987654321",
        username: "ChosenProjectBot",
        token: "test-project-token",
        ownerUserId: "123456789",
        managed: false,
      },
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("configuration rejects legacy or malformed shapes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-telegram-extension-config-"));
  const path = join(directory, "settings.json");
  try {
    await writeFile(
      path,
      JSON.stringify({ provisionerUrl: "https://example.test", apiKey: "legacy" }),
      "utf8",
    );
    await assert.rejects(
      () => loadGlobalSettings({ PI_TELEGRAM_EXTENSION_SETTINGS: path }),
      /settings .* are invalid/i,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("bot usernames are explicit and only normalized, never derived", () => {
  assert.equal(normalizeBotUsername(" @Chosen_ProjectBot "), "Chosen_ProjectBot");
  assert.throws(() => normalizeBotUsername("not-valid"), /must be 5 to 32/);
  assert.throws(() => normalizeBotUsername("ChosenProject"), /end with Bot/);
});
