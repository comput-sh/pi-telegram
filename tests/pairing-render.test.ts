import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { pairProjectBotOwner, renderPairingInstructions } from "../src/setup.ts";

const username = `${"a".repeat(29)}Bot`;
const code = "pair-123456";

test("pairing keeps the full code on its own line in narrow terminals", () => {
  for (const width of [11, 20, 40, 60, 80]) {
    const lines = renderPairingInstructions(username, code, width);
    assert.ok(lines.includes(code), `code missing at width ${width}`);
    assert.ok(lines.every((line) => line.length <= width));
    const content = lines.join("").replaceAll(" ", "");
    assert.ok(content.includes(`@${username}`));
    assert.ok(content.includes("PressStart,thensendthiscodeasoneline:"));
    assert.ok(content.includes("Esc:cancelpairing"));
    assert.ok(content.includes("Expiresafterthreeminutes."));
    assert.ok(!lines.some((line) => line.includes("…")));
  }
});

test("widths smaller than the pairing code wrap it without losing characters", () => {
  for (let width = 1; width < code.length; width++) {
    const lines = renderPairingInstructions(username, code, width);
    assert.ok(lines.every((line) => line.length <= width));
    assert.ok(lines.join("").includes(code));
    const content = lines.join("").replaceAll(" ", "");
    assert.ok(content.includes("Esc:cancelpairing"));
    assert.ok(content.includes("Expiresafterthreeminutes."));
  }
});

test("preparing pairing wraps the bot name and retains expiry and cancellation", () => {
  const lines = renderPairingInstructions(username, undefined, 20);
  assert.ok(lines.every((line) => line.length <= 20));
  const content = lines.join("").replaceAll(" ", "");
  assert.ok(content.includes("Preparingprivateownerpairingfor"));
  assert.ok(content.includes(`@${username}`));
  assert.ok(content.includes("Esc:cancelpairing"));
  assert.ok(content.includes("Expiresafterthreeminutes."));
  assert.ok(!content.includes("pair-"));
});

test("zero-width pairing renders no overflowing lines and recovers on resize", () => {
  assert.deepEqual(renderPairingInstructions(username, code, 0), []);
  assert.deepEqual(renderPairingInstructions(username, code, -1), []);
  assert.ok(renderPairingInstructions(username, code, 60).includes(code));
});

test("pairing UI renders the received code intact before mocked private pairing completes", async () => {
  const previous = globalThis.fetch;
  let component: { render(width: number): string[] };
  let displayedCode: string | undefined;
  let rendered = false;
  globalThis.fetch = (async (url, init) => {
    const method = String(url).split("/").at(-1)!;
    const ok = (result: unknown) => new Response(JSON.stringify({ ok: true, result }));
    if (method === "getMe") return ok({ id: 111, is_bot: true, username });
    if (method === "getWebhookInfo") return ok({ url: "" });
    assert.equal(method, "getUpdates");
    const body = JSON.parse(String(init?.body));
    if (body.offset === -1) return ok([]);
    assert.ok(rendered);
    assert.match(displayedCode!, /^pair-\d{6}$/);
    return ok([{
      update_id: 1,
      message: {
        text: displayedCode,
        chat: { id: 222, type: "private" },
        from: { id: 222, is_bot: false },
      },
    }]);
  }) as typeof fetch;
  const ctx = {
    ui: {
      custom: (factory: Function) => new Promise((resolve) => {
        component = factory({
          requestRender() {
            const lines = component.render(60);
            displayedCode = lines.find((line) => /^pair-\d{6}$/.test(line));
            assert.ok(lines.includes(`@${username}`));
            assert.ok(lines.includes("Esc: cancel pairing"));
            assert.ok(lines.includes("Expires after three minutes."));
            assert.ok(lines.every((line) => line.length <= 60));
            rendered = true;
          },
        }, {}, {}, resolve);
        assert.ok(component.render(60).join(" ").includes("Preparing private owner pairing"));
      }),
    },
  } as unknown as ExtensionContext;
  try {
    const paired = await pairProjectBotOwner(ctx, "test-token", username);
    assert.equal(paired.ownerUserId, "222");
    assert.equal(paired.username, username);
  } finally {
    globalThis.fetch = previous;
  }
});
