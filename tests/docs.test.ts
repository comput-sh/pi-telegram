import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../", import.meta.url));
const guides = ["docs/user-guide.md", "docs/agent-tools.md", "docs/development-status.md"];

test("onboarding guides have explicit package entries and resolving local Markdown links", async () => {
  const pkg = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
  for (const guide of guides) assert.ok(pkg.files.includes(guide), `explicitly ship ${guide}`);
  assert.ok(!pkg.files.includes("docs/**"), "do not publish internal diagnostic directories wholesale");
  for (const file of ["README.md", ...guides]) {
    const text = await readFile(resolve(root, file), "utf8");
    for (const [, href] of text.matchAll(/\]\(([^)]+)\)/g)) {
      if (/^(?:https?:|mailto:|#)/.test(href!)) continue;
      const [target, anchor] = href!.split("#");
      const path = resolve(root, dirname(file), target!);
      await access(path);
      if (anchor) {
        const content = await readFile(path, "utf8");
        const headings = [...content.matchAll(/^#+ (.+)$/gm)].map(([, heading]) => heading!.toLowerCase().replace(/[^\w -]/g, "").replace(/ /g, "-"));
        assert.ok(headings.includes(anchor), `${file}: missing anchor ${href}`);
      }
    }
  }
});

test("beginner onboarding distinguishes released package, command surfaces and safe recovery", async () => {
  const readme = await readFile(resolve(root, "README.md"), "utf8");
  for (const phrase of [/Documentation for 0\.6\.0/, /Upgrading from 0\.5\.0/, /generic `telegram_send` tool is replaced/, /pi install npm:@comput\/pi-telegram/, /Local Pi/, /Telegram/, /Terminal/, /Do not read files, change anything or run commands/, /pi -r/, /pi --session <id>/, /Keep the Pi terminal\/process running/, /not.*erase credentials or revoke tokens/, /not.*end-to-end encrypted/, /Do not start competing pollers or remove live lock files/]) assert.match(readme, phrase);
  assert.ok(readme.indexOf("## 3. Connect") < readme.indexOf("## Troubleshooting"));
  assert.doesNotMatch(readme, /npm (?:i|install) (?:-g )?@comput\/pi-telegram/);
  const advanced = await readFile(resolve(root, guides[0]!), "utf8");
  assert.match(advanced, /Advanced: manager-created bots/);
  assert.match(advanced, /Never delete live locks/);
  assert.match(advanced, /Package removal does not revoke a token/);
  const tools = await readFile(resolve(root, guides[1]!), "utf8");
  assert.match(tools, /Documentation for 0\.6\.0/);
  for (const text of [readme, advanced, tools]) assert.doesNotMatch(text, /Published version: 0\.5\.0|Development source only|unreleased development source|Unreleased source admits/);
  assert.match(advanced, /Use `telegram_post` for replies\/buttons/);
  assert.match(advanced, /no compatibility adapter/);
  assert.match(tools, /No redundant stop, artificial sleep or native-expiry wait/);
});
