import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import extension from "../src/index.ts";
import { TELEGRAM_INPUT_NOTICE } from "../src/routing.ts";

test("inbound notice uses approved concise formatting and milestone guidance, not draft mechanics", () => {
  assert.equal(TELEGRAM_INPUT_NOTICE,
    "[Message from Telegram. Use telegram_send for replies and progress updates; ordinary assistant text is not forwarded. During tool work, send concise progress updates at meaningful milestones. Keep hidden reasoning and raw tool details private. Format messages using Telegram Rich Markdown (GitHub-Flavored Markdown where possible). Use headings, lists, tables, links, quotes, code blocks, collapsible details, footnotes, and LaTeX when they improve clarity. Choose the formatting that best fits the response; short replies can remain simple text.]");
  assert.doesNotMatch(TELEGRAM_INPUT_NOTICE, /draft|prefix|status:|FULL accumulated/);
});

test("telegram_send distinguishes explicit activity control from retained draft streaming guidance", () => {
  const tools = new Map<string, any>();
  extension({
    on: () => {},
    registerCommand: () => {},
    registerTool: (tool: any) => tools.set(tool.name, tool),
  } as unknown as ExtensionAPI);
  const send = tools.get("telegram_send");
  assert.ok(send);
  const activity = send.promptGuidelines.find((text: string) => text.startsWith("ACTIVITY:"));
  const streaming = send.promptGuidelines.find((text: string) => text.startsWith("DRAFT STREAMING:"));
  assert.ok(activity);
  assert.ok(streaming);
  for (const guidance of [send.description, activity, send.parameters.properties.status.description]) {
    assert.match(guidance, /starting work/);
    assert.match(guidance, /while activity continues/);
    assert.match(guidance, /status-only/);
    assert.match(guidance, /waiting for (the )?user/);
    assert.match(guidance, /finaliz[es]+ any pending draft/);
    assert.match(guidance, /never (show )?Idle/);
    assert.match(guidance, /worker activity/);
    assert.match(guidance, /automatically/);
    assert.match(guidance, /15-minute expiry/);
  }
  assert.match(activity, /meaningful milestones/);
  assert.match(streaming, /FULL accumulated/);
  assert.match(streaming, /Exact prefix extensions/);
  assert.match(streaming, /Buttons always produce a persistent message/);
  assert.match(streaming, /No automatic assistant-text streaming/);
});
