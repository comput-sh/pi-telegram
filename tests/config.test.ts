import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  getTelegramPiConfigFilePath,
  loadTelegramPiConfig,
} from "../src/config.ts";

test("loadTelegramPiConfig reads user-selected configuration without package credentials", async () => {
  const directory = await mkdtemp(join(tmpdir(), "telegrampi-config-"));
  const path = join(directory, "telegrampi.json");
  try {
    await writeFile(
      path,
      JSON.stringify({
        provisionerUrl: "https://example.test/api/",
        apiKey: "test-key",
        botUsernamePrefix: "acme",
      }),
      "utf8",
    );
    const env = { TELEGRAMPI_CONFIG: path };
    assert.equal(getTelegramPiConfigFilePath(env), path);
    assert.deepEqual(await loadTelegramPiConfig(env), {
      provisionerUrl: "https://example.test/api",
      apiKey: "test-key",
      botUsernamePrefix: "acme",
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("environment configuration requires URL and key together", async () => {
  await assert.rejects(
    () => loadTelegramPiConfig({ TELEGRAMPI_API_KEY: "test-key" }),
    /must be set together/,
  );
  assert.deepEqual(
    await loadTelegramPiConfig({
      TELEGRAMPI_API_KEY: "test-key",
      TELEGRAMPI_PROVISIONER_URL: "https://example.test/api/",
    }),
    {
      provisionerUrl: "https://example.test/api",
      apiKey: "test-key",
      botUsernamePrefix: "pi",
    },
  );
});
