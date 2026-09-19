import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { RequestOrigins, registerResponseRouting } from "../src/request-routing.ts";
import type { TelegramSessionConnection } from "../src/telegram.ts";

test("request receipts require extension input and are consumed once", () => {
  const origins = new RequestOrigins<string>();
  const forged = origins.enqueue("hello", "bot");
  origins.admit(forged, "interactive");
  assert.equal(origins.begin(forged), undefined);
  const real = origins.enqueue("hello", "bot");
  origins.admit(real, "extension");
  assert.equal(origins.begin([{ type: "text", text: real }]), "bot");
  assert.equal(origins.begin(real), undefined);
});

test("reset invalidates queued requests", () => {
  const origins = new RequestOrigins<string>();
  const text = origins.enqueue("queued", "bot");
  origins.admit(text, "extension"); origins.reset();
  assert.equal(origins.begin(text), undefined);
});

test("inbound provenance remains available but assistant and tool events never send output", async () => {
  const handlers = new Map<string, Function>();
  const target = new Proxy({}, { get: () => { throw new Error("Unexpected automatic Telegram output"); } }) as TelegramSessionConnection;
  const pi = { on: (name: string, handler: Function) => handlers.set(name, handler) } as unknown as ExtensionAPI;
  const route = registerResponseRouting(pi, () => target);
  const text = route.origins.enqueue("hello", target);
  await handlers.get("input")!({ text, source: "extension" });
  await handlers.get("message_start")!({ message: { role: "user", content: text } });
  assert.equal(route.destination(), target);
  for (const name of ["message_update", "message_end", "tool_execution_start", "tool_execution_end"])
    assert.equal(handlers.has(name), false);
  await handlers.get("message_start")!({ message: { role: "assistant" } });
  await handlers.get("agent_settled")!({});
  assert.equal(route.destination(), undefined);
  assert.equal(route.outboundDestination(), target, "explicit proactive delivery remains possible");
});

test("stale inbound work cannot silently send to a replacement connection", async () => {
  const handlers = new Map<string, Function>();
  const original = {} as TelegramSessionConnection, replacement = {} as TelegramSessionConnection;
  let current = original;
  const route = registerResponseRouting({ on: (name: string, handler: Function) => handlers.set(name, handler) } as unknown as ExtensionAPI, () => current);
  const text = route.origins.enqueue("hello", original);
  handlers.get("input")!({ text, source: "extension" });
  handlers.get("message_start")!({ message: { role: "user", content: text } });
  const queued = route.origins.enqueue("queued before disconnect", original);
  route.reset(); current = replacement;
  assert.equal(route.outboundDestination(), undefined);
  handlers.get("agent_settled")!({});
  assert.equal(route.outboundDestination(), replacement);
  handlers.get("input")!({ text: queued, source: "extension" });
  handlers.get("message_start")!({ message: { role: "user", content: queued } });
  assert.equal(route.destination(), undefined);
  assert.equal(route.outboundDestination(), undefined, "retired queued receipts must not become proactive sends to the new bot");
});
