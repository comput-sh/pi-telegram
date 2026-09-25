import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Check } from "typebox/value";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import extension from "../src/index.ts";
import { validateEmbeddedContent } from "../src/rich-content.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const skillPath = "skills/pi-telegram/SKILL.md";
const referenceDir = "skills/pi-telegram/references";
async function skillFiles() {
  return [skillPath, ...(await readdir(resolve(root, referenceDir))).map(name => `${referenceDir}/${name}`)];
}

test("bundled skill is discoverable and its local reference links resolve inside the package", async () => {
  const pkg = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
  assert.deepEqual(pkg.pi.skills, ["./skills/pi-telegram"]);
  assert.ok(pkg.files.includes("skills/pi-telegram/**/*.md"));
  const files = await skillFiles();
  const skill = await readFile(resolve(root, skillPath), "utf8");
  assert.match(skill, /^---\nname: pi-telegram\ndescription: [^\n]{1,1024}\n---/);
  const linked = new Set<string>();
  for (const file of files) {
    const text = await readFile(resolve(root, file), "utf8");
    assert.ok(text.length < 6000, `${file} should stay focused`);
    assert.doesNotMatch(text, /telegram_send\b|api\.telegram\.org/);
    for (const [, target] of text.matchAll(/\]\(([^)]+\.md)\)/g)) {
      const path = relative(root, resolve(root, dirname(file), target!)).replaceAll("\\", "/");
      assert.ok(files.includes(path), `${file} links to unshipped ${path}`);
      linked.add(path);
    }
  }
  for (const reference of files.slice(1)) assert.ok(linked.has(reference), `${reference} must be discoverable`);
  assert.match(skill, /optional, on-demand/);
  assert.match(skill, /Tool descriptions and prompt guidelines remain mandatory/);
  assert.match(skill, /generic Thinking lifecycle tools/);
  const thinking = await readFile(resolve(root, referenceDir, "thinking-diagnostic.md"), "utf8");
  assert.match(thinking, /Normal path: start → direct handoff → update\/finalize/);
  assert.ok(thinking.indexOf('"action":"handoff"') < thinking.indexOf('"action":"stop"'), "teach direct handoff before optional standalone stop");
  assert.match(thinking, /Optional standalone stop/);
  assert.match(thinking, /not exact visible duration/);
  assert.match(thinking, /Model\/tool\/API latency and the up-to-five-second positive prior-pulse barrier/);
  assert.match(thinking, /not measured attribution/);
  const drafts = await readFile(resolve(root, referenceDir, "activity-and-drafts.md"), "utf8");
  assert.match(drafts, /\[Thinking start → direct handoff\]\(thinking-diagnostic\.md\)/);
});

test("skill JSON recipes use today's registered schemas and button limits", async () => {
  const tools = new Map<string, any>();
  extension({ on: () => {}, registerCommand: () => {}, registerTool: (tool: any) => tools.set(tool.name, tool) } as unknown as ExtensionAPI);
  let examples = 0;
  for (const file of await skillFiles()) {
    const text = await readFile(resolve(root, file), "utf8");
    const blocks = [...text.matchAll(/```json\n([\s\S]*?)\n```/g)];
    const annotated = [...text.matchAll(/[Tt]ool: `(telegram_\w+)`\n```json\n([\s\S]*?)\n```/g)];
    assert.equal(blocks.length, annotated.length, `${file}: label every JSON example with its tool`);
    for (const [, name, json] of annotated) {
      const tool = tools.get(name!);
      assert.ok(tool, `unknown tool ${name}`);
      const args = JSON.parse(json!);
      assert.equal(Check(tool.parameters, args), true, `${file}: invalid ${name} arguments`);
      if (name === "telegram_post" && args.content) {
        assert.equal(args.message, undefined);
        assert.equal(args.buttons, undefined);
        assert.doesNotThrow(() => validateEmbeddedContent(args.content));
      }
      if (args.buttons) {
        assert.ok(args.message && args.message.length <= 4096);
        for (const key of ["label", "reply"]) {
          assert.equal(new Set(args.buttons.map((button: any) => button[key].trim().toLowerCase())).size, args.buttons.length);
        }
      }
      examples++;
    }
  }
  assert.ok(examples >= 10);
});

test("npm pack includes all skill files and no private/development directories", { skip: process.env.npm_execpath ? false : "Run via npm test to inspect npm's actual pack list" }, async () => {
  const packed = JSON.parse(execFileSync(process.execPath, [process.env.npm_execpath!, "pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: root, encoding: "utf8" }));
  const files = packed[0].files.map((file: { path: string }) => file.path);
  for (const file of await skillFiles()) assert.ok(files.includes(file), `missing package file ${file}`);
  const docs = ["docs/user-guide.md", "docs/agent-tools.md", "docs/development-status.md"];
  for (const file of docs) assert.ok(files.includes(file), `missing offline guide ${file}`);
  for (const file of files.filter((path: string) => path.startsWith("docs/"))) assert.ok(docs.includes(file), `unexpected internal documentation ${file}`);
  for (const file of files) assert.doesNotMatch(file, /^(?:artifacts|\.[^/]+|tests|node_modules)\//);
});
