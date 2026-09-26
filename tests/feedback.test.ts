import assert from "node:assert/strict";
import test from "node:test";
import { TelegramSessionConnection } from "../src/telegram.ts";
import { feedbackEndpoint, submitFeedback, FEEDBACK_TTL } from "../src/feedback.ts";

const endpoint = "https://feedback.example.test/submit";
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise<void>(resolve => setImmediate(resolve)); };
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; };
async function fixture(run: (f: any) => Promise<void>, enabled = true, endpointOverride = endpoint) {
  const previous = globalThis.fetch, requests: any[] = [], inputs: any[] = [];
  let next = 10, eligible = false, stops = 0, hook = async (_request: any) => {};
  const connection = new TelegramSessionConnection("test-token", 42, { canStop: () => eligible, botId: 777, feedback: enabled ? { endpoint: endpointOverride, version: "0.6.0" } : undefined });
  globalThis.fetch = (async (url, init) => {
    const request = { url: String(url), method: String(url) === endpoint ? "feedback" : String(url).split("/").at(-1), body: JSON.parse(String(init?.body)), init, id: ++next };
    requests.push(request); await hook(request);
    return request.method === "feedback" ? new Response(null, { status: 200 }) : new Response(JSON.stringify({ ok: true, result: { message_id: request.id } }));
  }) as typeof fetch;
  const dispatch = (message: any) => (connection as any).dispatch({ update_id: 1, message: { message_id: 300, chat: { id: 42, type: "private" }, from: { id: 42, is_bot: false }, ...message } }, (m: any) => { inputs.push(m); }, () => { stops++; }, () => "status", () => false);
  const botMessage = (request: any) => ({ message_id: request.id, text: request.body.text, chat: { id: 42, type: "private" }, from: { id: 777, is_bot: true } });
  const prompt = () => requests.filter(r => r.body.reply_markup?.force_reply).at(-1);
  const preview = () => requests.filter(r => r.body.text?.startsWith("Pi Telegram feedback preview\n")).at(-1);
  const click = (action: "submit" | "cancel", overrides = {}) => {
    const p = preview();
    const data = p.body.reply_markup.inline_keyboard[0][action === "submit" ? 0 : 1].callback_data;
    (connection as any).dispatch({ update_id: 2, callback_query: { id: "callback", from: { id: 42, is_bot: false }, message: botMessage(p), data, ...overrides } }, (m: any) => inputs.push(m), () => {}, () => "status", () => false);
  };
  try { await run({ connection, requests, inputs, dispatch, botMessage, prompt, preview, click, setCanStop: (value: boolean) => { eligible = value; }, stops: () => stops, hook: (h: typeof hook) => { hook = h; } }); }
  finally { await connection.stop(); globalThis.fetch = previous; }
}

test("disabled feedback is unavailable before collection, but native command remains discoverable", async () => fixture(async f => {
  f.dispatch({ text: "/feedback" }); await flush();
  assert.equal(f.prompt(), undefined); assert.equal(f.preview(), undefined);
  assert.equal(f.inputs.length, 0);
  assert.ok(f.requests.some((r: any) => r.body.text?.includes("not available")));
  assert.equal(f.requests.filter((r: any) => r.method === "feedback").length, 0);
}, false));

test("feedback needs exact owner prompt reply and Submit; payload is feedback/version only, empty200 accepted", async () => fixture(async f => {
  await f.connection.post("Existing agent question", [{ label: "Yes", reply: "yes" }]);
  const question = (f.connection as any).question;
  f.dispatch({ text: "/feedback" }); await flush();
  const p = f.prompt(); assert.equal(p.body.reply_markup.force_reply, true);
  f.dispatch({ text: "/status is confusing", reply_to_message: f.botMessage(p) }); await flush();
  assert.equal((f.connection as any).question, question);
  assert.equal(f.inputs.length, 0);
  assert.ok(f.preview().body.text.includes("/status is confusing"));
  assert.ok(f.preview().body.text.includes("0.6.0"));
  assert.equal(f.requests.filter((r: any) => r.method === "feedback").length, 0);
  f.click("submit", { from: { id: 9, is_bot: false } });
  f.click("submit", { message: { ...f.botMessage(f.preview()), message_id: 999 } });
  f.click("submit", { message: { ...f.botMessage(f.preview()), chat: { id: 42, type: "group" } } });
  f.click("submit", { data: "feedback:forged:submit" });
  f.click("submit"); f.click("submit"); await flush();
  const submissions = f.requests.filter((r: any) => r.method === "feedback");
  assert.equal(submissions.length, 1);
  assert.deepEqual(submissions[0].body, { feedback: "/status is confusing", version: "0.6.0" });
  assert.equal(submissions[0].init.redirect, "error"); assert.equal(submissions[0].init.credentials, "omit");
  assert.ok(f.requests.some((r: any) => r.body.text === "Thank you — feedback submitted."));
  assert.equal(f.requests.filter((r: any) => r.method === "deleteMessage" && r.body.message_id === p.id).length, 1, "Submit and retirement must not double-delete the prompt");
  assert.equal(f.requests.filter((r: any) => r.method === "editMessageReplyMarkup" && r.body.message_id === f.preview().id).length, 1);
  assert.equal(f.inputs.length, 0); assert.equal((f.connection as any).question, question);
}));

test("unrelated messages stay agent input; feedback text length/type and identity are checked", async () => fixture(async f => {
  f.dispatch({ text: "/feedback" }); await flush(); const p = f.botMessage(f.prompt());
  f.dispatch({ text: "ordinary message" });
  f.dispatch({ text: "not current", reply_to_message: { ...p, message_id: 999, text: "An ordinary question" } });
  assert.equal(f.inputs.length, 2);
  f.dispatch({ text: "wrong owner", reply_to_message: p, from: { id: 1, is_bot: false } });
  f.dispatch({ text: "group", reply_to_message: p, chat: { id: 42, type: "group" } });
  for (const message of [{ text: " " }, { text: "x".repeat(2001) }, { document: { file_id: "not-downloaded" } }]) f.dispatch({ ...message, reply_to_message: p });
  await flush(); assert.equal(f.preview(), undefined); assert.equal(f.inputs.length, 2);
  f.dispatch({ text: "x".repeat(2000), reply_to_message: p }); await flush(); assert.ok(f.preview());
  f.click("cancel"); await flush();
  assert.equal(f.requests.filter((r: any) => r.method === "feedback").length, 0);
}));

test("stale prompt AND preview replies are suppressed across reconnect even with endpoint disabled", async () => {
  let prompt: any, preview: any;
  await fixture(async f => {
    f.dispatch({ text: "/feedback" }); await flush(); prompt = f.botMessage(f.prompt());
    f.dispatch({ text: "Private feedback", reply_to_message: prompt }); await flush(); preview = f.botMessage(f.preview());
    f.click("cancel"); await flush();
  });
  await fixture(async f => {
    for (const reply of [prompt, preview]) f.dispatch({ text: "More private feedback", reply_to_message: reply });
    await flush(); assert.equal(f.inputs.length, 0);
    f.dispatch({ text: "Quoted text", reply_to_message: { ...prompt, from: { id: 42, is_bot: false } } });
    f.dispatch({ text: "Other bot", reply_to_message: { ...prompt, from: { id: 888, is_bot: true } } });
    f.dispatch({ text: "Forwarded copy", reply_to_message: { ...prompt, forward_origin: { type: "user" } } });
    f.dispatch({ text: prompt.text });
    assert.equal(f.inputs.length, 4, "copies/other bots/ordinary text are not a feedback authorization or blanket filter");
    assert.equal(f.requests.filter((r: any) => r.method === "feedback").length, 0);
  }, false);
});

test("expiry and replacement retire old feedback and never forward late sensitive replies", async t => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  await fixture(async f => {
    f.dispatch({ text: "/feedback" }); await flush(); const old = f.botMessage(f.prompt());
    f.dispatch({ text: "/feedback" }); await flush(); const current = f.botMessage(f.prompt());
    f.dispatch({ text: "Old", reply_to_message: old }); await flush(); assert.equal(f.preview(), undefined);
    t.mock.timers.tick(FEEDBACK_TTL); await flush();
    f.dispatch({ text: "Expired", reply_to_message: current }); await flush();
    assert.equal(f.preview(), undefined); assert.equal(f.inputs.length, 0);
    f.dispatch({ text: "/feedback" }); await flush();
    f.dispatch({ text: "Preview to expire", reply_to_message: f.botMessage(f.prompt()) }); await flush();
    t.mock.timers.tick(FEEDBACK_TTL); await flush(); f.click("submit"); await flush();
    assert.equal(f.requests.filter((r: any) => r.method === "feedback").length, 0);
  });
});

test("Submit is one-use before HTTP await, ordinary intake remains free, Stop reports uncertainty", async () => fixture(async f => {
  f.dispatch({ text: "/feedback" }); await flush();
  f.dispatch({ text: "Feedback", reply_to_message: f.botMessage(f.prompt()) }); await flush();
  const held = deferred(); f.hook(async (r: any) => { if (r.method === "feedback") await held.promise; });
  f.click("submit"); f.click("submit"); await flush();
  f.dispatch({ text: "/feedback" }); f.dispatch({ text: "ordinary during HTTP" }); await flush();
  assert.equal(f.inputs.length, 1); assert.equal(f.requests.filter((r: any) => r.method === "feedback").length, 1);
  f.dispatch({ text: "stop" }); await flush(); held.resolve(); await flush();
  assert.ok(f.requests.some((r: any) => r.body.text?.includes("Delivery is unconfirmed")));
  assert.ok(!f.requests.some((r: any) => r.body.text === "Thank you — feedback submitted."));
}));

test("late prompt/preview completion after disconnect cannot revive consent", async () => {
  for (const stage of ["prompt", "preview"]) await fixture(async f => {
    const held = deferred(), entered = deferred();
    if (stage === "preview") { f.dispatch({ text: "/feedback" }); await flush(); }
    f.hook(async (r: any) => { if (r.body.reply_markup?.force_reply && stage === "prompt" || r.body.text?.startsWith("Pi Telegram feedback preview\n") && stage === "preview") { entered.resolve(); await held.promise; } });
    if (stage === "prompt") f.dispatch({ text: "/feedback" });
    else f.dispatch({ text: "feedback", reply_to_message: f.botMessage(f.prompt()) });
    await entered.promise;
    await f.connection.stop(); held.resolve(); await flush();
    assert.equal((f.connection as any).feedback.current, undefined);
    assert.equal(f.requests.filter((r: any) => r.method === "feedback").length, 0);
  });
});

test("held old prompt/preview cannot replace a newer flow or authorize old Submit", async () => {
  for (const stage of ["prompt", "preview"]) await fixture(async f => {
    const held = deferred(), entered = deferred(); let once = false;
    if (stage === "preview") { f.dispatch({ text: "/feedback" }); await flush(); }
    f.hook(async (r: any) => {
      if (!once && (stage === "prompt" && r.body.reply_markup?.force_reply || stage === "preview" && r.body.text?.startsWith("Pi Telegram feedback preview\n"))) { once = true; entered.resolve(); await held.promise; }
    });
    if (stage === "prompt") f.dispatch({ text: "/feedback" });
    else f.dispatch({ text: "Old feedback", reply_to_message: f.botMessage(f.prompt()) });
    await entered.promise;
    const old = stage === "prompt" ? f.prompt() : f.preview();
    f.dispatch({ text: "/feedback" }); await flush(); const newer = f.prompt();
    held.resolve(); await flush();
    assert.notEqual(newer.id, old.id);
    assert.equal((f.connection as any).feedback.current.promptId, newer.id);
    f.dispatch({ text: "Old sensitive reply", reply_to_message: f.botMessage(old) }); await flush();
    assert.equal((f.connection as any).feedback.current.phase, "awaiting");
    f.dispatch({ text: "New feedback", reply_to_message: f.botMessage(newer) }); await flush();
    assert.ok(f.preview().body.text.includes("New feedback"));
    if (stage === "preview") f.click("submit", { message: f.botMessage(old), data: old.body.reply_markup.inline_keyboard[0][0].callback_data });
    f.click("cancel"); f.click("submit"); await flush();
    assert.equal(f.requests.filter((r: any) => r.method === "feedback").length, 0); assert.equal(f.inputs.length, 0);
  });
});

test("exact-prompt Stop respects eligible/noneligible agent abort authority", async () => {
  for (const eligible of [false, true]) await fixture(async f => {
    f.setCanStop(eligible);
    await f.connection.post("Agent question", [{ label: "Yes", reply: "yes" }]);
    f.dispatch({ text: "/feedback" }); await flush();
    f.dispatch({ text: "/stop", reply_to_message: f.botMessage(f.prompt()) }); await flush();
    assert.equal(f.stops(), eligible ? 1 : 0);
    assert.equal((f.connection as any).feedback.current, undefined);
    assert.equal((f.connection as any).question, undefined);
    assert.equal(f.inputs.length, 0); assert.equal(f.requests.filter((r: any) => r.method === "feedback").length, 0);
  });
});

test("invalid configured endpoint is unavailable BEFORE text collection", async () => fixture(async f => {
  f.dispatch({ text: "/feedback" }); await flush();
  assert.equal(f.prompt(), undefined); assert.equal(f.preview(), undefined); assert.equal(f.inputs.length, 0);
}, true, "https://feedback.example.test/?secret=not-allowed"));

test("global Stop retains priority inside feedback reply, Cancel stays independent from agent question", async () => fixture(async f => {
  await f.connection.post("Agent question", [{ label: "Yes", reply: "yes" }]);
  const question = (f.connection as any).question;
  f.dispatch({ text: "/feedback" }); await flush();
  f.dispatch({ text: "A comment", reply_to_message: f.botMessage(f.prompt()) }); await flush();
  f.click("cancel"); await flush();
  assert.equal((f.connection as any).question, question);
  f.dispatch({ text: "/feedback" }); await flush();
  f.dispatch({ text: "/stop", reply_to_message: f.botMessage(f.prompt()) }); await flush();
  assert.equal((f.connection as any).feedback.current, undefined);
  assert.equal((f.connection as any).question, undefined, "existing global Stop authority is preserved");
  assert.equal(f.inputs.length, 0); assert.equal(f.requests.filter((r: any) => r.method === "feedback").length, 0);
}));

test("HTTP raw error details never appear in feedback outcome or trigger replay", async () => fixture(async f => {
  f.dispatch({ text: "/feedback" }); await flush();
  f.dispatch({ text: "Comment", reply_to_message: f.botMessage(f.prompt()) }); await flush();
  f.hook(async (r: any) => { if (r.method === "feedback") throw new Error("PRIVATE_SERVER_ERROR_DETAIL"); });
  f.click("submit"); await flush(); f.click("submit"); await flush();
  assert.equal(f.requests.filter((r: any) => r.method === "feedback").length, 1);
  assert.ok(f.requests.some((r: any) => r.body.text?.includes("may have arrived")));
  assert.ok(!f.requests.some((r: any) => JSON.stringify(r.body).includes("PRIVATE_SERVER_ERROR_DETAIL")));
  assert.equal(f.inputs.length, 0);
}));

test("endpoint validation refuses collection destinations with credentials or nonHTTPS", () => {
  assert.equal(feedbackEndpoint(undefined), undefined);
  for (const value of ["http://example.test", "https://u:p@example.test", "https://example.test/?secret=x", "https://example.test/#fragment", "not a URL"]) assert.throws(() => feedbackEndpoint(value));
});

test("HTTP submission accepts only200, never consumes JSON/body, times out and never retries", async () => {
  const previous = globalThis.fetch, originalTimeout = AbortSignal.timeout;
  try {
    let calls = 0;
    globalThis.fetch = (async () => { calls++; return { status: 200, body: { cancel: () => new Promise(() => {}) }, json: () => assert.fail("must not parse body") } as unknown as Response; }) as typeof fetch;
    assert.equal(await submitFeedback(endpoint, "feedback", "0.6.0", new AbortController().signal), true);
    for (const status of [201, 204, 400, 500]) {
      globalThis.fetch = (async () => { calls++; return new Response(null, { status }); }) as typeof fetch;
      assert.equal(await submitFeedback(endpoint, "feedback", "0.6.0", new AbortController().signal), false);
    }
    const delays: number[] = [];
    AbortSignal.timeout = (ms: number) => { delays.push(ms); return originalTimeout(1); };
    globalThis.fetch = (async () => { calls++; return new Promise<Response>(() => {}); }) as typeof fetch;
    const keepAlive = setTimeout(() => {}, 50);
    try { assert.equal(await submitFeedback(endpoint, "feedback", "0.6.0", new AbortController().signal), false); }
    finally { clearTimeout(keepAlive); }
    assert.deepEqual(delays, [10_000]); assert.equal(calls, 6);
  } finally { globalThis.fetch = previous; AbortSignal.timeout = originalTimeout; }
});
