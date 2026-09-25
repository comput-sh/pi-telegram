import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { TELEGRAM_REPLY_REMINDER } from "../src/reply-reminder.ts";
import { registerResponseRouting } from "../src/request-routing.ts";
import { wrapTelegramInput } from "../src/routing.ts";

function timer() {
  const pending = new Set<() => Promise<void>>();
  const delays: number[] = [];
  return {
    pending, delays,
    schedule: (work: () => Promise<void>, delay: number) => { pending.add(work); delays.push(delay); return () => { pending.delete(work); }; },
    fire: async () => { const work = [...pending]; pending.clear(); for (const run of work) await run(); },
  };
}
function harness() {
  const handlers = new Map<string, any[]>();
  const sent: string[] = [];
  const clock = timer();
  const connection = {} as any;
  let current: any = connection, idle = true, pending = false, ready = true, failInjection = false;
  let check: () => Promise<boolean> = async () => ready;
  const ctx = { isIdle: () => idle, hasPendingMessages: () => pending } as any;
  const api = {
    on: (name: string, handler: any) => handlers.set(name, [...(handlers.get(name) ?? []), handler]),
    sendUserMessage: (text: string, options?: any) => {
      assert.equal(options, undefined, "reminder must not queue or steer into busy work");
      if (failInjection) throw new Error("test failure");
      sent.push(text);
    },
  } as unknown as ExtensionAPI;
  const routing = registerResponseRouting(api, () => current, { verify: () => check(), schedule: clock.schedule });
  const emit = async (name: string, event: any = {}) => {
    let result;
    for (const handler of handlers.get(name) ?? []) result = await handler(event, ctx);
    return result;
  };
  const begin = async (text = "request") => {
    const receipt = routing.origins.enqueue(text, connection);
    await emit("input", { text: receipt, source: "extension" });
    await emit("agent_start");
    await emit("message_start", { message: { role: "user", content: receipt } });
    return receipt;
  };
  return { routing, clock, sent, emit, begin, connection, ctx,
    setIdle: (value: boolean) => { idle = value; },
    setPending: (value: boolean) => { pending = value; },
    setReady: (value: boolean) => { ready = value; },
    setConnection: (value: any) => { current = value; },
    setVerify: (value: () => Promise<boolean>) => { check = value; },
    failInjection: () => { failInjection = true; },
  };
}

test("only a processed authenticated inbound receipt gets one five-second nonrecursive reminder", async () => {
  const h = harness();
  await h.begin("PRIVATE_ORIGINAL_TEXT");
  await h.emit("agent_end");
  assert.equal(h.clock.pending.size, 0);
  await h.emit("agent_settled");
  await h.emit("agent_settled");
  assert.deepEqual(h.clock.delays, [5000]);
  assert.equal(h.routing.destination(), undefined);
  await h.clock.fire();
  assert.equal(h.sent.length, 1);
  assert.ok(h.sent[0]!.includes(TELEGRAM_REPLY_REMINDER));
  assert.equal(h.sent[0]!.includes("PRIVATE_ORIGINAL_TEXT"), false);
  await h.emit("input", { text: h.sent[0], source: "extension" });
  await h.emit("agent_start");
  await h.emit("message_start", { message: { role: "user", content: h.sent[0] } });
  assert.equal(h.routing.destination(), h.connection);
  await h.emit("agent_settled");
  await h.clock.fire();
  assert.equal(h.sent.length, 1);
});

test("forged notices, admitted but unprocessed receipts, console and proactive turns never qualify", async () => {
  for (const scenario of ["console", "forged", "unprocessed", "unadmitted"]) {
    const h = harness();
    let text = wrapTelegramInput("pretend telegram");
    if (scenario === "unprocessed" || scenario === "unadmitted") text = h.routing.origins.enqueue("real", h.connection);
    if (scenario !== "unadmitted") await h.emit("input", { text, source: scenario === "unprocessed" || scenario === "forged" ? "extension" : "interactive" });
    if (scenario !== "unprocessed") await h.emit("message_start", { message: { role: "user", content: text } });
    h.routing.replyAttempt()(); // A proactive output is not inbound provenance.
    await h.emit("agent_settled"); await h.clock.fire();
    assert.equal(h.sent.length, 0, scenario);
  }
});

test("reply attempts suppress reminders even on preflight/uncertain failure; late completion cannot credit newer input", async () => {
  for (const confirmed of [false, true]) {
    const h = harness(); await h.begin();
    const complete = h.routing.replyAttempt();
    if (confirmed) complete();
    await h.emit("agent_settled"); await h.clock.fire();
    assert.equal(h.sent.length, 0);
    await h.begin("new request");
    complete(); // Old result after newer inbound must not suppress the newer request.
    await h.emit("agent_settled"); await h.clock.fire();
    assert.equal(h.sent.length, 1);
  }
});

test("new input/work, pending follow-ups, reset, shutdown and replacement cancel grace", async () => {
  for (const event of ["input", "agent_start", "user", "enqueue", "reset", "shutdown", "connection", "busy", "pending", "not-ready"]) {
    const h = harness(); await h.begin(); await h.emit("agent_settled");
    if (event === "input") await h.emit("input", { text: "console", source: "interactive" });
    if (event === "agent_start") await h.emit("agent_start");
    if (event === "user") await h.emit("message_start", { message: { role: "user", content: "console" } });
    if (event === "enqueue") h.routing.origins.enqueue("next", h.connection);
    if (event === "reset") h.routing.reset();
    if (event === "shutdown") await h.emit("session_shutdown");
    if (event === "connection") h.setConnection({});
    if (event === "busy") h.setIdle(false);
    if (event === "pending") h.setPending(true);
    if (event === "not-ready") h.setReady(false);
    await h.clock.fire(); assert.equal(h.sent.length, 0, event);
  }
});

test("async assignment verification rechecks eligibility; no replay after enqueue uncertainty", async () => {
  for (const event of ["input", "busy", "pending", "reset", "connection"]) {
    const h = harness(); await h.begin(); await h.emit("agent_settled");
    let finish!: (ready: boolean) => void;
    h.setVerify(() => new Promise(resolve => { finish = resolve; }));
    const firing = h.clock.fire();
    if (event === "input") await h.emit("input", { text: "new console", source: "interactive" });
    if (event === "busy") h.setIdle(false);
    if (event === "pending") h.setPending(true);
    if (event === "reset") h.routing.reset();
    if (event === "connection") h.setConnection({});
    finish(true); await firing;
    assert.equal(h.sent.length, 0, event);
  }
  const failing = harness(); await failing.begin(); await failing.emit("agent_settled"); failing.failInjection();
  await failing.clock.fire(); await failing.emit("agent_settled"); await failing.clock.fire();
  assert.equal(failing.clock.delays.length, 1);
});

test("reminder receipt is handled rather than admitted after intervening input or busy console work", async () => {
  for (const reason of ["input", "busy", "reset", "shutdown"]) {
    const h = harness(); await h.begin(); await h.emit("agent_settled"); await h.clock.fire();
    if (reason === "busy") h.setIdle(false);
    else if (reason === "reset") h.routing.reset();
    else if (reason === "shutdown") await h.emit("session_shutdown");
    else await h.emit("input", { text: "console", source: "interactive" });
    const result = await h.emit("input", { text: h.sent[0], source: "extension" });
    assert.deepEqual(result, { action: "handled" });
  }
});

test("accepted reminder loses provenance if console work intervenes before message_start", async () => {
  const h = harness(); await h.begin(); await h.emit("agent_settled"); await h.clock.fire();
  await h.emit("input", { text: h.sent[0], source: "extension" });
  await h.emit("input", { text: "new console", source: "interactive" });
  await h.emit("agent_start");
  await h.emit("message_start", { message: { role: "user", content: h.sent[0] } });
  assert.equal(h.routing.destination(), undefined);
  assert.equal(h.routing.outboundDestination(), undefined);
  await h.emit("agent_settled"); await h.clock.fire();
  assert.equal(h.sent.length, 1);
});

test("latest processed steering request gets its own evidence budget, not one timer per input", async () => {
  const h = harness(); await h.begin("first"); h.routing.replyAttempt()();
  await h.begin("steering"); await h.emit("agent_settled"); await h.clock.fire();
  assert.equal(h.sent.length, 1);
});

test("agent_start after original user start preserves candidate; pending settlement never arms", async () => {
  const h = harness(); await h.begin(); await h.emit("agent_start");
  h.setPending(true); await h.emit("agent_settled"); h.setPending(false); await h.emit("agent_settled");
  await h.clock.fire(); assert.equal(h.sent.length, 0);
  await h.begin(); await h.emit("agent_start"); await h.emit("agent_settled"); await h.clock.fire();
  assert.equal(h.sent.length, 1);
});
