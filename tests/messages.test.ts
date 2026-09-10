import assert from "node:assert/strict";
import test from "node:test";

import {
  extractPublicAssistantText,
  findLatestAssistantText,
  getPublicTextPhase,
  splitTelegramText,
} from "../src/messages.ts";

test("findLatestAssistantText returns public text only", () => {
  const result = findLatestAssistantText([
    { id: "u1", type: "message", message: { role: "user", content: "hello" } },
    {
      id: "a1",
      type: "message",
      message: {
        role: "assistant",
        timestamp: 123,
        content: [
          { type: "thinking", thinking: "secret" },
          { type: "text", text: "Visible response" },
          { type: "toolCall", name: "read" },
        ],
      },
    },
  ]);

  assert.deepEqual(result, {
    entryId: "a1",
    messageTimestamp: 123,
    text: "Visible response",
  });
});

test("extractPublicAssistantText ignores reasoning and tool calls", () => {
  assert.equal(
    extractPublicAssistantText({
      role: "assistant",
      stopReason: "toolUse",
      content: [
        { type: "thinking", thinking: "private" },
        { type: "text", text: "Public progress" },
        { type: "toolCall", name: "bash" },
      ],
    }),
    "Public progress",
  );
});

test("getPublicTextPhase reads Pi phase metadata", () => {
  assert.equal(
    getPublicTextPhase({
      content: [
        {
          type: "text",
          text: "progress",
          textSignature: JSON.stringify({ v: 1, id: "a", phase: "commentary" }),
        },
      ],
    }),
    "commentary",
  );
  assert.equal(
    getPublicTextPhase({
      content: [
        {
          type: "text",
          text: "answer",
          textSignature: JSON.stringify({ v: 1, id: "b", phase: "final_answer" }),
        },
      ],
    }),
    "final_answer",
  );
});

test("splitTelegramText keeps chunks within Telegram limit", () => {
  const chunks = splitTelegramText(`${"a".repeat(2500)} ${"b".repeat(2500)}`, 4000);
  assert.equal(chunks.join(" ").length, 5001);
  assert.ok(chunks.every((chunk) => chunk.length <= 4000));
});
