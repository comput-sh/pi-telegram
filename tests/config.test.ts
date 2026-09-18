import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

import {
  assignProjectBot,
  findSessionBot,
  getGlobalSettingsPath,
  getProjectSettingsPath,
  loadGlobalSettings,
  loadProjectSettings,
  normalizeBotUsername,
  releaseProjectBot,
  removeProjectBot,
  saveGlobalSettings,
  saveProjectSettings,
  upsertAndAssignProjectBot,
  withManagerLock,
} from "../src/config.ts";

function projectSettings() {
  return {
    version: 2 as const,
    bots: [
      {
        id: "987654321",
        username: "ChosenProjectBot",
        token: "test-project-token",
        ownerUserId: "123456789",
        managed: false,
        sessionId: "session-main",
      },
    ],
  };
}

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

test("global manager settings include pending and known managed bots", async () => {
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
        knownBots: [
          {
            id: "400500600",
            username: "ChosenManagedBot",
            ownerUserId: "123456789",
            lastSeenAt: "2026-09-10T00:01:00.000Z",
          },
        ],
      },
    };
    await saveGlobalSettings(settings, env);
    assert.deepEqual(await loadGlobalSettings(env), settings);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("project bot settings store multiple private session assignments", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-telegram-project-"));
  try {
    const settings = projectSettings();
    await saveProjectSettings(directory, settings);
    assert.equal(
      getProjectSettingsPath(directory),
      join(directory, ".pi", "pi-telegram.local.json"),
    );
    assert.deepEqual(await loadProjectSettings(directory), settings);
    assert.deepEqual(
      JSON.parse(await readFile(getProjectSettingsPath(directory), "utf8")),
      settings,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("assignment moves a bot and preserves all project credentials", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-telegram-project-"));
  try {
    await saveProjectSettings(directory, {
      version: 2,
      bots: [
        ...projectSettings().bots,
        {
          id: "111222333",
          username: "ResearchProjectBot",
          token: "research-token",
          ownerUserId: "123456789",
          managed: true,
          sessionId: "session-research",
        },
      ],
    });
    const assigned = await assignProjectBot(
      directory,
      "987654321",
      "session-research",
    );
    assert.equal(assigned.sessionId, "session-research");
    const updated = (await loadProjectSettings(directory))!;
    assert.equal(findSessionBot(updated, "session-research")?.id, "987654321");
    assert.equal(updated.bots.find((bot) => bot.id === "111222333")?.sessionId, null);
    assert.equal(updated.bots.length, 2);

    assert.equal(
      await releaseProjectBot(directory, "987654321", "session-main"),
      false,
    );
    assert.equal(
      await releaseProjectBot(directory, "987654321", "session-research"),
      true,
    );
    assert.equal(
      (await loadProjectSettings(directory))!.bots.find(
        (bot) => bot.id === "987654321",
      )?.sessionId,
      null,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("removing a bot deletes only the selected project credentials", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-telegram-project-"));
  try {
    await saveProjectSettings(directory, {
      version: 2,
      bots: [
        ...projectSettings().bots,
        {
          id: "111222333",
          username: "ResearchProjectBot",
          token: "research-token",
          ownerUserId: "123456789",
          managed: true,
          sessionId: null,
        },
      ],
    });
    const removed = await removeProjectBot(directory, "111222333");
    assert.equal(removed?.username, "ResearchProjectBot");
    assert.deepEqual((await loadProjectSettings(directory))!.bots, projectSettings().bots);
    assert.equal(await removeProjectBot(directory, "111222333"), undefined);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("upserting a bot updates credentials and assigns only one bot to a session", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-telegram-project-"));
  try {
    await saveProjectSettings(directory, projectSettings());
    await upsertAndAssignProjectBot(
      directory,
      {
        id: "111222333",
        username: "ResearchProjectBot",
        token: "research-token",
        ownerUserId: "123456789",
        managed: true,
      },
      "session-main",
    );
    const settings = (await loadProjectSettings(directory))!;
    assert.equal(settings.bots.length, 2);
    assert.equal(findSessionBot(settings, "session-main")?.id, "111222333");
    assert.equal(settings.bots.find((bot) => bot.id === "987654321")?.sessionId, null);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("legacy settings load unassigned and duplicate session assignments are rejected", async () => {
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

    await import("node:fs/promises").then(({ mkdir }) =>
      mkdir(join(directory, ".pi"), { recursive: true }),
    );
    const legacy = projectSettings().bots[0]!;
    await writeFile(
      getProjectSettingsPath(directory),
      JSON.stringify({
        version: 1,
        bot: {
          id: legacy.id,
          username: legacy.username,
          token: legacy.token,
          ownerUserId: legacy.ownerUserId,
          managed: legacy.managed,
        },
      }),
      "utf8",
    );
    assert.deepEqual(await loadProjectSettings(directory), {
      version: 2,
      bots: [{ ...legacy, sessionId: null }],
    });

    await writeFile(
      getProjectSettingsPath(directory),
      JSON.stringify({
        version: 2,
        bots: [
          legacy,
          {
            ...legacy,
            id: "111222333",
            username: "OtherProjectBot",
          },
        ],
      }),
      "utf8",
    );
    await assert.rejects(
      () => loadProjectSettings(directory),
      /assign multiple bots to one Pi session/,
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

test("global credential settings are excluded before writing and tracked paths are rejected", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-telegram-global-git-"));
  const path = join(directory, "private", "settings.json");
  const env = { PI_TELEGRAM_SETTINGS: path };
  try {
    await execFileAsync("git", ["init"], { cwd: directory });
    await saveGlobalSettings({ version: 1, provisioningMode: "manual" }, env);
    const ignored = await execFileAsync(
      "git",
      ["check-ignore", "private/settings.json"],
      { cwd: directory },
    );
    assert.match(ignored.stdout, /private\/settings\.json/);
    await execFileAsync("git", ["add", "-f", "private/settings.json"], {
      cwd: directory,
    });
    await assert.rejects(
      () => saveGlobalSettings({ version: 1, provisioningMode: "manual" }, env),
      /is tracked by Git/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("project settings are excluded before writing and tracked paths are rejected", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-telegram-git-"));
  const settings = projectSettings();
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
      await symlink(target, join(directory, ".pi"), "junction");
    } catch (error) {
      if (["EPERM", "EACCES"].includes((error as NodeJS.ErrnoException).code || "")) {
        t.skip("Symbolic links are unavailable on this host");
        return;
      }
      throw error;
    }
    await assert.rejects(
      () => saveProjectSettings(directory, projectSettings()),
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
