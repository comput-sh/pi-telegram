import assert from "node:assert/strict";
import test from "node:test";

import {
  isTelegramInput,
  routeTelegramInput,
  TELEGRAM_INPUT_NOTICE,
  wrapTelegramInput,
} from "../src/routing.ts";

test("routeTelegramInput uses explicit steering and escapes literal bangs", () => {
  assert.deepEqual(routeTelegramInput("Normal request"), {
    text: "Normal request",
    deliverAs: "followUp",
  });
  assert.deepEqual(routeTelegramInput("! Change direction"), {
    text: "Change direction",
    deliverAs: "steer",
  });
  assert.deepEqual(routeTelegramInput("!Immediately"), {
    text: "Immediately",
    deliverAs: "steer",
  });
  assert.deepEqual(routeTelegramInput("!!important"), {
    text: "!important",
    deliverAs: "followUp",
  });
  assert.deepEqual(routeTelegramInput("!"), {
    text: "!",
    deliverAs: "followUp",
  });
});

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
