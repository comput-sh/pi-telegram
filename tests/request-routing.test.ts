import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  RequestOrigins,
  registerResponseRouting,
} from "../src/request-routing.ts";
import type { TelegramSessionConnection } from "../src/telegram.ts";

test("request receipts are admitted only from extension input and consumed once", () => {
  const origins = new RequestOrigins<string>();
  const text = origins.enqueue("hello", "original-bot");
  origins.admit(text, "interactive");
  assert.equal(origins.begin(text), undefined);
  const trusted = origins.enqueue("hello", "original-bot");
  origins.admit(trusted, "extension");
  assert.equal(
    origins.begin([{ type: "text", text: trusted }]),
    "original-bot",
  );
  assert.equal(origins.begin(trusted), undefined);
});

test("reset invalidates queued requests across reconnect or session replacement", () => {
  const origins = new RequestOrigins<string>();
  const text = origins.enqueue("queued", "old-bot");
  origins.admit(text, "extension");
  origins.reset();
  assert.equal(origins.begin(text), undefined);
});

test("responses remain bound to receiving connection; old transcript is never replayed", async () => {
  const handlers = new Map<string, Function>();
  const pi = {
    on: (name: string, handler: Function) => handlers.set(name, handler),
  } as unknown as ExtensionAPI;
  const sent: string[] = [];
  const fake = (id: string) =>
    ({
      beginRichDraft: async () => {},
      cancelRichDraft: async () => {},
      sendRichMessage: async (text: string) => {
        sent.push(`${id}:${text}`);
      },
    }) as unknown as TelegramSessionConnection;
  const original = fake("original");
  const replacement = fake("replacement");
  let current = original;
  const responses = registerResponseRouting(pi, () => current);
  const ctx = { ui: { notify: () => {} } };
  const request = responses.origins.enqueue("hello", original);
  await handlers.get("input")!({ text: request, source: "extension" }, ctx);
  await handlers.get("message_start")!(
    { message: { role: "user", content: request } },
    ctx,
  );
  assert.equal(responses.destination(), original);
  current = replacement;
  await handlers.get("message_end")!(
    {
      message: {
        role: "assistant",
        content: [{ type: "text", text: "late response" }],
        stopReason: "stop",
      },
    },
    ctx,
  );
  await handlers.get("agent_settled")!({}, ctx);
  assert.deepEqual(sent, []);
});

test("activity survives completed messages and overlapping tools until settlement", async () => {
  const handlers = new Map<string, Function>();
  let active = false;
  let starts = 0;
  const activities: Array<string | undefined> = [];
  const sent: string[] = [];
  const target = {
    beginRichDraft: async () => { if (!active) starts++; active = true; },
    cancelRichDraft: async () => { active = false; },
    setDraftActivity: async (name?: string) => { activities.push(name); },
    sendRichMessage: async (text: string) => { active = false; sent.push(text); },
  } as unknown as TelegramSessionConnection;
  const responses = registerResponseRouting({ on: (name: string, handler: Function) => handlers.set(name, handler) } as unknown as ExtensionAPI, () => target);
  const ctx = { ui: { notify: () => {} } };
  const emit = async (name: string, event: any) => handlers.get(name)?.(event, ctx);
  // Console-originated assistant events must never create Telegram activity.
  await emit("message_start", { message: { role: "assistant" } });
  assert.equal(starts, 0);
  const text = responses.origins.enqueue("hello", target);
  await emit("input", { text, source: "extension" });
  await emit("message_start", { message: { role: "user", content: text } });
  await emit("tool_execution_start", { toolCallId: "a", toolName: "bash" });
  await emit("tool_execution_start", { toolCallId: "b", toolName: "read" });
  await emit("tool_execution_end", { toolCallId: "b" });
  assert.equal(activities.at(-1), "bash");
  await emit("tool_execution_end", { toolCallId: "a" });
  assert.equal(activities.at(-1), undefined);
  for (const stopReason of ["length", "stop"]) {
    await emit("message_end", { message: { role: "assistant", stopReason, content: [{ type: "text", text: stopReason }] } });
    assert.ok(active, "activity must remain during compaction/continuation");
    await emit("message_start", { message: { role: "assistant" } });
  }
  assert.equal(starts, 3);
  await emit("agent_settled", {});
  assert.equal(active, false);
  assert.deepEqual(sent, ["length", "stop"]);
  await emit("message_start", { message: { role: "assistant" } });
  assert.equal(active, false);
});

test("multiple completed responses deliver separately with no settled duplicate", async () => {
  const handlers = new Map<string, Function>();
  const pi = {
    on: (name: string, handler: Function) => handlers.set(name, handler),
  } as unknown as ExtensionAPI;
  const sent: string[] = [];
  const target = {
    beginRichDraft: async () => {},
    cancelRichDraft: async () => {},
    sendRichMessage: async (text: string) => {
      sent.push(text);
    },
  } as unknown as TelegramSessionConnection;
  const responses = registerResponseRouting(pi, () => target);
  const ctx = { ui: { notify: () => {} } };
  const text = responses.origins.enqueue("hello", target);
  await handlers.get("input")!({ text, source: "extension" }, ctx);
  await handlers.get("message_start")!(
    { message: { role: "user", content: text } },
    ctx,
  );
  for (const text of ["one", "two"])
    await handlers.get("message_end")!(
      {
        message: {
          role: "assistant",
          stopReason: "stop",
          content: [{ type: "text", text }],
        },
      },
      ctx,
    );
  await handlers.get("agent_settled")!({}, ctx);
  assert.deepEqual(sent, ["one", "two"]);
});
