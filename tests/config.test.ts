import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

import {
  getGlobalSettingsPath,
  getProjectSettingsPath,
  loadGlobalSettings,
  loadProjectSettings,
  normalizeBotUsername,
  saveGlobalSettings,
  saveProjectSettings,
  withManagerLock,
} from "../src/config.ts";

test("global manual mode is saved without manager credentials", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-telegram-config-"));
  const path = join(directory, "settings.json");
  const env = { PI_TELEGRAM_SETTINGS: path };
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
  const directory = await mkdtemp(join(tmpdir(), "pi-telegram-config-"));
  const path = join(directory, "settings.json");
  const env = { PI_TELEGRAM_SETTINGS: path };
  try {
    const settings = {
      version: 1 as const,
      provisioningMode: "manager" as const,
      manager: {
        id: "100200300",
        username: "ExampleManagerBot",
        token: "test-manager-token",
        updateOffset: 42,
        pending: {
          username: "ChosenManagedBot",
          displayName: "Chosen Managed Bot",
          requestedAt: "2026-09-10T00:00:00.000Z",
        },
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
  const directory = await mkdtemp(join(tmpdir(), "pi-telegram-project-"));
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
      join(directory, ".pi", "pi-telegram.local.json"),
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
  const directory = await mkdtemp(join(tmpdir(), "pi-telegram-config-"));
  const path = join(directory, "settings.json");
  try {
    await writeFile(
      path,
      JSON.stringify({ serviceUrl: "https://example.test", apiKey: "legacy" }),
      "utf8",
    );
    await assert.rejects(
      () => loadGlobalSettings({ PI_TELEGRAM_SETTINGS: path }),
      /settings .* are invalid/i,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("manager operations are serialized by a global lock", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-telegram-lock-"));
  const env = { PI_TELEGRAM_SETTINGS: join(directory, "settings.json") };
  try {
    await withManagerLock(async () => {
      await assert.rejects(
        () => withManagerLock(async () => undefined, env),
        /Another Pi session is configuring/,
      );
    }, env);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("project settings are excluded before writing and tracked paths are rejected", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-telegram-git-"));
  const settings = {
    version: 1 as const,
    id: "987654321",
    username: "ChosenProjectBot",
    token: "test-project-token",
    ownerUserId: "123456789",
    managed: false,
  };
  try {
    await execFileAsync("git", ["init"], { cwd: directory });
    await saveProjectSettings(directory, settings);
    const ignored = await execFileAsync(
      "git",
      ["check-ignore", ".pi/pi-telegram.local.json"],
      { cwd: directory },
    );
    assert.match(ignored.stdout, /pi-telegram\.local\.json/);

    await execFileAsync(
      "git",
      ["add", "-f", ".pi/pi-telegram.local.json"],
      { cwd: directory },
    );
    await assert.rejects(
      () => saveProjectSettings(directory, settings),
      /is tracked by Git/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("project settings reject a symbolic private directory", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "pi-telegram-symlink-"));
  const target = await mkdtemp(join(tmpdir(), "pi-telegram-target-"));
  try {
    try {
      await import("node:fs/promises").then(({ symlink }) =>
        symlink(target, join(directory, ".pi"), "junction"),
      );
    } catch (error) {
      if (["EPERM", "EACCES"].includes((error as NodeJS.ErrnoException).code || "")) {
        t.skip("Symbolic links are unavailable on this host");
        return;
      }
      throw error;
    }
    await assert.rejects(
      () =>
        saveProjectSettings(directory, {
          version: 1,
          id: "987654321",
          username: "ChosenProjectBot",
          token: "test-project-token",
          ownerUserId: "123456789",
          managed: false,
        }),
      /symbolic path/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
    await rm(target, { recursive: true, force: true });
  }
});

test("bot usernames are explicit and only normalized, never derived", () => {
  assert.equal(normalizeBotUsername(" @Chosen_ProjectBot "), "Chosen_ProjectBot");
  assert.throws(() => normalizeBotUsername("not-valid"), /must be 5 to 32/);
  assert.throws(() => normalizeBotUsername("ChosenProject"), /end with Bot/);
});
