import assert from "node:assert/strict";
import test from "node:test";

import {
  formatSessionStartupMessage,
  formatSessionStatusMessage,
} from "../src/host.ts";

test("formatSessionStartupMessage shows only connection, project, and IP on one line", () => {
  assert.equal(
    formatSessionStartupMessage({
      projectName: "SampleProject",
      branch: "feature/telegram",
      hostname: "workstation",
      ip: "192.168.1.20",
    }),
    "Connected · SampleProject · 192.168.1.20",
  );
});

test("startup includes the captured running version on the same line", () => {
  assert.equal(formatSessionStartupMessage({ projectName: "Demo", hostname: "host", ip: "192.168.1.2", version: "0.2.2" }),
    "Connected · Demo · 192.168.1.2 · v0.2.2");
});

test("formatSessionStatusMessage uses the status heading", () => {
  const message = formatSessionStatusMessage({
    projectName: "SampleProject",
    branch: "main",
    hostname: "workstation",
    ip: "192.168.1.20",
  });
  assert.match(message, /^Pi Telegram session status$/m);
  assert.match(message, /^Branch: main$/m);
  assert.match(message, /^Host: workstation \(192\.168\.1\.20\)$/m);
  assert.match(message, /^Normal messages: steer active Telegram work; new turn when idle$/m);
  assert.match(message, /^\/steer message: explicitly steer active work$/m);
  assert.match(message, /^Leading ! characters are literal text$/m);
  assert.match(message, /^Send stop: cancel the current Telegram task$/m);
});

test("formatSessionStartupMessage handles unavailable branch and IP", () => {
  const message = formatSessionStartupMessage({
    projectName: "LooseFiles",
    hostname: "workstation",
    ip: "unknown",
  });
  assert.equal(message, "Connected · LooseFiles · unknown");
});
