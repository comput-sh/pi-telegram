import assert from "node:assert/strict";
import test from "node:test";

import {
  formatSessionStartupMessage,
  formatSessionStatusMessage,
} from "../src/host.ts";

test("formatSessionStartupMessage includes project, branch, host, and controls", () => {
  assert.equal(
    formatSessionStartupMessage({
      projectName: "SampleProject",
      branch: "feature/telegram",
      hostname: "workstation",
      ip: "192.168.1.20",
    }),
    [
      "New Pi session connected",
      "Project: SampleProject",
      "Branch: feature/telegram",
      "Host: workstation (192.168.1.20)",
      "",
      "Normal messages: follow-up",
      "Prefix !: steer active work",
      "Prefix !!: send a literal leading !",
      "Send stop: cancel the current Telegram task",
    ].join("\n"),
  );
});

test("formatSessionStatusMessage uses the status heading", () => {
  const message = formatSessionStatusMessage({
    projectName: "SampleProject",
    branch: "main",
    hostname: "workstation",
    ip: "192.168.1.20",
  });
  assert.match(message, /^Pi Telegram Extension session status$/m);
  assert.match(message, /^Branch: main$/m);
});

test("formatSessionStartupMessage omits branch outside a repository", () => {
  const message = formatSessionStartupMessage({
    projectName: "LooseFiles",
    hostname: "workstation",
    ip: "unknown",
  });
  assert.doesNotMatch(message, /^Branch:/m);
});
