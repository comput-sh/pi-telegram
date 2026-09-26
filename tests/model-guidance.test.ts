import assert from "node:assert/strict";
import test from "node:test";
import { Check } from "typebox/value";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import extension from "../src/index.ts";
import { TELEGRAM_INPUT_NOTICE } from "../src/routing.ts";
import { ReplyReminder } from "../src/reply-reminder.ts";

function registeredTools() {
  const tools = new Map<string, any>();
  extension({ on: () => {}, registerCommand: () => {}, registerTool: (tool: any) => tools.set(tool.name, tool) } as unknown as ExtensionAPI);
  return tools;
}

test("inbound notice names explicit tools without generic send or implicit lifecycle mechanics", () => {
  assert.match(TELEGRAM_INPUT_NOTICE, /telegram_post/);
  assert.match(TELEGRAM_INPUT_NOTICE, /telegram_draft/);
  assert.match(TELEGRAM_INPUT_NOTICE, /telegram_edit/);
  assert.match(TELEGRAM_INPUT_NOTICE, /telegram_activity/);
  assert.match(TELEGRAM_INPUT_NOTICE, /meaningful milestones/);
  assert.match(TELEGRAM_INPUT_NOTICE, /GitHub-Flavored Markdown/);
  assert.doesNotMatch(TELEGRAM_INPUT_NOTICE, /telegram_send\b|prefix|status:/);
});

test("explicit tools have mandatory independent lifecycle and security guidance; generic send is removed", () => {
  const tools = registeredTools();
  assert.equal(tools.has("telegram_send"), false);
  assert.ok([...tools.keys()].every(name => !name.includes("feedback")), "native feedback must not expose a model tool");
  for (const name of ["telegram_post", "telegram_draft", "telegram_edit", "telegram_activity"]) {
    const tool = tools.get(name);
    assert.ok(tool);
    const guidance = tool.promptGuidelines.join(" ");
    assert.match(guidance, /verified bot/);
    assert.match(guidance, /without prior inbound text/);
    assert.match(guidance, /uncertain/);
    assert.match(guidance, /not blindly replay/);
    assert.match(guidance, /hidden reasoning/);
    assert.match(guidance, /independent/);
  }
  assert.match(tools.get("telegram_draft").description, /full replacement/);
  assert.match(tools.get("telegram_draft").description, /4096/);
  assert.match(tools.get("telegram_edit").description, /button-message/);
  const activity = tools.get("telegram_activity").description;
  for (const phrase of [/work start/, /15-minute expiry/, /waiting for the user/, /Never shows Idle/, /does not finalize/, /worker-status mirroring/, /not cancellation/]) assert.match(activity, phrase);
  assert.ok(tools.has("telegram_send_file"));
  assert.ok(tools.has("telegram_send_photo"));
});

test("only durable reply tools record reminder evidence synchronously before preflight awaits", async () => {
  const tools = registeredTools();
  const original = ReplyReminder.prototype.attempt;
  let attempts = 0;
  ReplyReminder.prototype.attempt = () => { attempts++; return () => {}; };
  try {
    for (const [name, args, expected] of [
      ["telegram_post", { message: "reply" }, 1],
      ["telegram_post", { message: "question", buttons: [{ label: "Yes", reply: "Yes" }] }, 1],
      ["telegram_post", { content: [{ type: "button_row", buttons: [{ label: "Yes", reply: "Yes" }] }] }, 1],
      ["telegram_edit", { messageRef: "unknown", message: "replacement" }, 1],
      ["telegram_draft", { action: "finalize", draftRef: "unknown" }, 1],
      ["telegram_send_file", { path: "missing.txt" }, 1],
      ["telegram_send_photo", { path: "missing.png" }, 1],
      ["telegram_draft", { action: "start", message: "preview" }, 0],
      ["telegram_draft", { action: "update", draftRef: "unknown", message: "preview" }, 0],
      ["telegram_draft", { action: "discard", draftRef: "unknown" }, 0],
      ["telegram_activity", { action: "working" }, 0],
      ["telegram_chat_action", { action: "typing" }, 0],
      ["telegram_thinking", { action: "start" }, 0],
      ["telegram_thinking", { action: "stop", thinkingRef: "unknown" }, 0],
      ["telegram_thinking", { action: "handoff", thinkingRef: "unknown", message: "answer preview" }, 0],
    ] as const) {
      attempts = 0;
      const execution = tools.get(name).execute("test", args, undefined, undefined, {});
      assert.equal(attempts, expected, name);
      await assert.rejects(execution);
    }
  } finally { ReplyReminder.prototype.attempt = original; }
});

test("embedded post schema is narrow, exclusive and request-driven with pre-I/O runtime guards", async () => {
  const tool = registeredTools().get("telegram_post");
  const content = [{ type: "paragraph", parts: [{ type: "text", text: "Choose " }, { type: "button", label: "Inspect", reply: "Inspect only" }] }, { type: "button_row", buttons: [{ label: "Wait", reply: "Wait" }] }];
  assert.equal(Check(tool.parameters, { content }), true);
  assert.equal(Check(tool.parameters, { message: "ordinary", buttons: [{ label: "Yes", reply: "Yes" }] }), true);
  assert.deepEqual(tool.parameters.properties.content.items.properties.type.enum, ["paragraph", "button_row"]);
  for (const value of [
    { content: [{ type: "raw", blocks: [] }] },
    { content: [{ type: "paragraph", parts: [{ type: "button", label: "Yes", reply: "Yes", callback_data: "bypass" }] }] },
    { content: [{ type: "button_row", buttons: [{ label: "Yes", reply: "Yes", url: "https://example.com" }] }] },
    { content: [] },
  ]) assert.equal(Check(tool.parameters, value), false);
  for (const args of [
    {}, { message: "x", content }, { content, buttons: [{ label: "No", reply: "No" }] }, { message: "x", raw_blocks: [] },
    { content: [{ type: "paragraph", buttons: [{ label: "x", reply: "x" }] }] },
    { content: [{ type: "paragraph", parts: [{ type: "text", text: "x", label: "bad" }] }] },
    { content: [{ type: "paragraph", parts: [{ type: "text", text: "no choices" }] }] },
    { content: [{ type: "button_row", buttons: [{ label: " ", reply: "x" }] }] },
    { content: [{ type: "button_row", buttons: [{ label: "Yes", reply: "x" }, { label: " yes ", reply: "y" }] }] },
    { content: [{ type: "paragraph", parts: [{ type: "text", text: "x".repeat(4096) }, { type: "button", label: "Yes", reply: "yes" }] }] },
  ]) await assert.rejects(tool.execute("test", args, undefined, undefined, {}), /Post|Embedded|Paragraph|Button|Text/);
  const guidance = tool.promptGuidelines.join(" ");
  assert.match(guidance, /only on explicit user request or stated conversational preference/);
  assert.match(guidance, /never automatic embellishment or an enable mode/);
  assert.match(guidance, /share one pending question/);
  assert.match(guidance, /Inside these HTML elements use HTML inline markup, not Markdown/);
  assert.match(guidance, /<table compact>/);
  assert.match(guidance, /<blockquote expandable>/);
});

test("Thinking lifecycle uses a flat schema, explicit refs and action-specific preflight guards", async () => {
  const tool = registeredTools().get("telegram_thinking");
  assert.ok(tool);
  assert.deepEqual(tool.parameters.properties.action.enum, ["start", "stop", "handoff"]);
  assert.equal(tool.parameters.properties.action.type, "string");
  assert.equal(tool.parameters.properties.action.anyOf, undefined);
  for (const args of [{ action: "start" }, { action: "start", refreshSeconds: 0 }, { action: "start", refreshSeconds: 30 }, { action: "stop", thinkingRef: "t" }, { action: "handoff", thinkingRef: "t", message: "full answer" }]) assert.equal(Check(tool.parameters, args), true);
  for (const args of [{}, { refreshSeconds: 0 }, { action: "start", text: "reasoning" }, { action: "clear" }, { action: "finalize" }, { action: "start", refreshSeconds: -1 }, { action: "start", refreshSeconds: 31 }, { action: "start", refreshSeconds: 1.5 }]) assert.equal(Check(tool.parameters, args), false);
  for (const args of [
    {}, { action: "clear" }, { action: "start", refreshSeconds: 31 },
    { action: "start", thinkingRef: "t" }, { action: "start", message: "reasoning" },
    { action: "stop" }, { action: "stop", thinkingRef: " " }, { action: "stop", thinkingRef: "t", refreshSeconds: 0 }, { action: "stop", thinkingRef: "t", message: "x" },
    { action: "handoff", thinkingRef: "t" }, { action: "handoff", message: "x" }, { action: "handoff", thinkingRef: "t", message: " " }, { action: "handoff", thinkingRef: "t", message: "x".repeat(32769) }, { action: "handoff", thinkingRef: "t", message: "x", refreshSeconds: 0 },
  ]) await assert.rejects(tool.execute("test", args, undefined, undefined, {}), /Thinking|refreshSeconds/);
  assert.match(tool.description, /fixed generic Thinking/);
  assert.match(tool.description, /DEFAULT 30/);
  assert.match(tool.description, /thinkingRef after first API acceptance/);
  assert.match(tool.description, /positive prior-pulse completion/);
  assert.match(tool.description, /NEW native ID/);
  assert.match(tool.description, /does not reserve a slot/);
  assert.match(tool.description, /without expiry timer/);
  assert.match(tool.description, /fences previews until connection teardown/);
  assert.match(tool.promptGuidelines.join(" "), /No 30-second expiry wait/);
  assert.match(tool.promptGuidelines.join(" "), /same authenticated request\/turn/);
  assert.match(tool.promptSnippet, /start → direct handoff → explicit draft update\/finalize/);
  assert.match(tool.description, /already stops future refresh/);
  assert.match(tool.description, /without a redundant stop or artificial sleep/);
  assert.match(tool.description, /refreshSeconds bounds scheduled refresh, not exact visible duration/);
  assert.match(tool.promptGuidelines.join(" "), /Standalone stop\(ref\) is optional/);
  assert.match(tool.promptGuidelines.join(" "), /model\/tool\/API latency and the up-to-5-second positive-pulse barrier/);
  assert.match(tool.promptGuidelines.join(" "), /without implying a measured cause/);
});

test("native typing diagnostic schema and guidance keep the first-acceptance background contract", async () => {
  const tool = registeredTools().get("telegram_chat_action");
  assert.ok(tool);
  assert.deepEqual(tool.parameters.properties.action.enum, ["typing"]);
  assert.equal(tool.parameters.properties.action.type, "string");
  assert.equal(tool.parameters.properties.action.anyOf, undefined);
  for (const args of [{ action: "typing" }, { action: "typing", refreshSeconds: 0 }, { action: "typing", refreshSeconds: 30 }]) assert.equal(Check(tool.parameters, args), true);
  for (const args of [{}, { action: "clear" }, { action: "typing", durationSeconds: 5 }, { action: "typing", refreshSeconds: -1 }, { action: "typing", refreshSeconds: 31 }, { action: "typing", refreshSeconds: 1.5 }]) assert.equal(Check(tool.parameters, args), false);
  assert.match(tool.description, /Returns after the first API acceptance/);
  assert.match(tool.description, /background/);
  assert.match(tool.description, /new call supersedes/);
  assert.match(tool.description, /no clear action/);
  assert.match(tool.description, /not guaranteed/);
  assert.match(tool.promptGuidelines.join(" "), /explicitly requested/);
  assert.match(tool.promptGuidelines.join(" "), /first test typing alone/);
  await assert.rejects(tool.execute("test", { action: "clear" }, undefined, undefined, {}), /no clear action/);
  await assert.rejects(tool.execute("test", { action: "typing", refreshSeconds: 31 }, undefined, undefined, {}), /integer from 0 to 30/);
});

test("explicit tool schemas reject implicit status and runtime guards enforce action/ref combinations", async () => {
  const tools = registeredTools();
  const accepts = (name: string, args: unknown) => Check(tools.get(name).parameters, args);
  assert.equal(accepts("telegram_post", { message: "Done" }), true);
  assert.equal(accepts("telegram_post", { message: "Done", status: "working" }), false);
  assert.equal(accepts("telegram_post", {}), false);
  for (const args of [{ action: "start", message: "a" }, { action: "update", draftRef: "d", message: "b" }, { action: "finalize", draftRef: "d" }, { action: "discard", draftRef: "d" }]) assert.equal(accepts("telegram_draft", args), true);
  for (const args of [{ action: "start" }, { action: "start", message: "x", draftRef: "d" }, { action: "update", draftRef: "d" }, { action: "finalize" }, { action: "discard", draftRef: "d", message: "no" }]) await assert.rejects(tools.get("telegram_draft").execute("test", args, undefined, undefined, {}), /Draft/);
  for (const name of ["telegram_draft", "telegram_activity"]) {
    assert.equal(tools.get(name).parameters.type, "object");
    assert.equal(tools.get(name).parameters.properties.action.type, "string");
    assert.ok(tools.get(name).parameters.properties.action.enum);
    assert.equal(tools.get(name).parameters.properties.action.anyOf, undefined);
    assert.equal(tools.get(name).parameters.properties.action.const, undefined);
  }
  assert.equal(accepts("telegram_edit", { messageRef: "m", message: "replacement" }), true);
  assert.equal(accepts("telegram_edit", { draftRef: "d", message: "replacement" }), false);
  assert.equal(accepts("telegram_activity", { action: "working" }), true);
  assert.equal(accepts("telegram_activity", { action: "clear" }), true);
  assert.equal(accepts("telegram_activity", {}), false);
  await assert.rejects(tools.get("telegram_draft").execute("test", { action: "unknown" }, undefined, undefined, {}), /Unknown draft action/);
  await assert.rejects(tools.get("telegram_activity").execute("test", { action: "unknown" }, undefined, undefined, {}), /Activity must be/);
});
