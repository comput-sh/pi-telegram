import assert from "node:assert/strict";
import test from "node:test";

import {
  getOrProvisionProjectBot,
  lookupProjectBotByKey,
} from "../src/provisioner.ts";

test("getOrProvisionProjectBot uses the explicit provisioning endpoint", async () => {
  const originalFetch = globalThis.fetch;
  let requestUrl: string | undefined;
  let requestInit: RequestInit | undefined;
  globalThis.fetch = (async (input, init) => {
    requestUrl = String(input);
    requestInit = init;
    return new Response(
      JSON.stringify({
        projectKey: "sample-12345678",
        projectName: "Sample",
        botUsername: "cpuSampleBot",
        status: "pending",
        creationUrl: "https://t.me/newbot/setup/sample",
      }),
      { status: 202, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;

  try {
    const bot = await getOrProvisionProjectBot(
      { provisionerUrl: "https://provisioner.example/api", apiKey: "test-key" },
      "Sample",
    );

    assert.equal(requestUrl, "https://provisioner.example/api/bots");
    assert.equal(requestInit?.method, "POST");
    assert.equal(
      (requestInit?.headers as Record<string, string>)["x-functions-key"],
      "test-key",
    );
    assert.deepEqual(JSON.parse(String(requestInit?.body)), {
      projectName: "Sample",
    });
    assert.equal(bot.status, "pending");
    assert.equal(bot.botUsername, "cpuSampleBot");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("getOrProvisionProjectBot sends a selected custom username", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody: unknown;
  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body));
    return new Response(
      JSON.stringify({
        projectKey: "sample-12345678",
        projectName: "Sample",
        botUsername: "cpuChosenBot",
        status: "pending",
      }),
      { status: 202, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;

  try {
    await getOrProvisionProjectBot(
      { provisionerUrl: "https://provisioner.example/api", apiKey: "test-key" },
      "Sample",
      "cpuChosenBot",
    );
    assert.deepEqual(requestBody, {
      projectName: "Sample",
      botUsername: "cpuChosenBot",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("lookupProjectBotByKey addresses the stable project binding", async () => {
  const originalFetch = globalThis.fetch;
  let requestUrl: string | undefined;
  globalThis.fetch = (async (input) => {
    requestUrl = String(input);
    return new Response(
      JSON.stringify({
        projectKey: "sample/key",
        projectName: "Sample",
        botUsername: "cpuSampleBot",
        status: "ready",
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;

  try {
    const bot = await lookupProjectBotByKey(
      { provisionerUrl: "https://provisioner.example/api", apiKey: "test-key" },
      "sample/key",
    );
    assert.equal(
      requestUrl,
      "https://provisioner.example/api/bots/sample%2Fkey",
    );
    assert.equal(bot?.botUsername, "cpuSampleBot");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
