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
  assert.match(message, /^Normal messages: follow-up$/m);
  assert.match(message, /^Prefix !: steer active work$/m);
  assert.match(message, /^Prefix !!: send a literal leading !$/m);
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
