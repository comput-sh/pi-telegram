import assert from "node:assert/strict";
import test from "node:test";
import type {
  ExtensionContext,
  ExtensionUIContext,
} from "@earendil-works/pi-coding-agent";
import { pairProjectBotOwner, promptSecret } from "../src/setup.ts";

test("masked token prompt abort closes UI and never renders token characters", async () => {
  const controller = new AbortController();
  const ui = {
    custom: (factory: Function) =>
      new Promise((resolve) => {
        const component = factory({ requestRender() {} }, {}, {}, resolve);
        component.handleInput("test-token");
        assert.ok(!component.render(80).join("\n").includes("test-token"));
        controller.abort();
      }),
  } as unknown as ExtensionUIContext;
  assert.equal(
    await promptSecret(ui, "Enter token", controller.signal),
    undefined,
  );
});

test("Escape during pairing waits for the polling request to abort", async () => {
  const previous = globalThis.fetch;
  let cancel: (() => void) | undefined;
  let aborted = false;
  globalThis.fetch = (async (url, init) => {
    const method = String(url).split("/").at(-1)!;
    const ok = (result: unknown) =>
      new Response(JSON.stringify({ ok: true, result }));
    if (method === "getMe")
      return ok({ id: 111, is_bot: true, username: "ExampleBot" });
    if (method === "getWebhookInfo") return ok({ url: "" });
    const body = JSON.parse(String(init?.body));
    if (body.offset === -1) return ok([]);
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener(
        "abort",
        () => {
          aborted = true;
          reject(new Error("cancelled"));
        },
        { once: true },
      );
      cancel?.();
    });
  }) as typeof fetch;
  const ctx = {
    ui: {
      custom: (factory: Function) =>
        new Promise((resolve) => {
          const component = factory({ requestRender() {} }, {}, {}, resolve);
          cancel = () => component.handleInput("\x1b");
        }),
    },
  } as unknown as ExtensionContext;
  try {
    await assert.rejects(pairProjectBotOwner(ctx, "test-token", "ExampleBot"));
    assert.equal(aborted, true);
  } finally {
    globalThis.fetch = previous;
  }
});
