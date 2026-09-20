import assert from "node:assert/strict";
import test from "node:test";

import {
  isTelegramInput,
  routeTelegramInput,
  TELEGRAM_INPUT_NOTICE,
  wrapTelegramInput,
} from "../src/routing.ts";

for (const busy of [false, true]) {
  test(`text routes by busy state (${busy}) without interpreting leading bangs`, () => {
    for (const text of ["Normal request", "! Change direction", "!Immediately", "!!important", "!", "  !! literal  "]) {
      assert.deepEqual(routeTelegramInput(text, busy), {
        text,
        deliverAs: busy ? "steer" : "followUp",
      });
    }
  });
}

test("wrapTelegramInput adds the public transport notice", () => {
  assert.equal(
    wrapTelegramInput("How is the build?"),
    `${TELEGRAM_INPUT_NOTICE}\n\nHow is the build?`,
  );
});

test("isTelegramInput recognizes string and structured user content", () => {
  const wrapped = wrapTelegramInput("Hello");
  assert.equal(isTelegramInput(wrapped), true);
  assert.equal(isTelegramInput([{ type: "text", text: wrapped }]), true);
  assert.equal(isTelegramInput([{ type: "text", text: "Local prompt" }]), false);
  assert.equal(isTelegramInput("Local prompt"), false);
});
