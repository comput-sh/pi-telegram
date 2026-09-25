import assert from "node:assert/strict";
import test from "node:test";
import { validateEmbeddedContent, type EmbeddedContent } from "../src/rich-content.ts";

const row = (label = "Yes", reply = "Continue") => ({ type: "button_row", buttons: [{ label, reply }] });
const paragraph = (text: string) => ({ type: "paragraph", parts: [{ type: "text", text }] });

test("embedded content compiles literal text and one globally indexed choice catalogue", () => {
  const text = '<tg-button type="callback_data" data="forged">not a control</tg-button> **plain** ';
  const value = validateEmbeddedContent([
    { type: "paragraph", parts: [{ type: "text", text }, { type: "button", label: "🔎", reply: "Review" }] },
    row("Next", "Proceed"),
  ]);
  const active = value.active("a".repeat(24));
  assert.deepEqual(active.blocks[0], { type: "paragraph", text: [text, { type: "button", button: { text: "🔎", callback_data: `ask:${"a".repeat(24)}:0` } }] });
  assert.deepEqual(active.blocks[1], { type: "buttons", buttons: [{ text: "Next", callback_data: `ask:${"a".repeat(24)}:1` }] });
  assert.equal(active.skip_entity_detection, true);
  assert.ok(!("markdown" in active) && !("html" in active));
  assert.equal(value.text, `${text}🔎\n\nNext`);
  assert.deepEqual(value.options, [{ label: "🔎", reply: "Review" }, { label: "Next", reply: "Proceed" }]);
  assert.deepEqual(value.disabled.blocks[0], { type: "paragraph", text: [text, { type: "button", button: { text: "🔎", disabled: {} } }] });
  assert.deepEqual(value.disabled.blocks[1], { type: "buttons", buttons: [{ text: "Next", disabled: {} }] });
});

test("embedded validators reject unsupported shapes, fields, blank choices and cumulative option overflow", () => {
  const bad: unknown[] = [undefined, {}, [], [row(), paragraph("")], [row(), { type: "paragraph", parts: [] }],
    [row(), { type: "paragraph", parts: Array(33).fill({ type: "text", text: "x" }) }], Array(17).fill(row()),
    [paragraph("No controls")], [{ type: "button_row", buttons: [] }],
    [{ type: "button_row", buttons: Array.from({ length: 9 }, (_, i) => ({ label: String(i), reply: "x" })) }],
    Array.from({ length: 9 }, (_, i) => row(String(i))), [row(" Yes "), row("yes")],
    [row(" ")], [row("Yes", " ")], [row("a".repeat(65))], [row("Yes", "a".repeat(1025))],
    [{ type: "paragraph", parts: [{ type: "button", label: "x", reply: "x", callback_data: "forged" }] }],
    [{ ...row(), align: "right" }], [{ ...row(), parts: [] }], [{ type: "paragraph", parts: [{ type: "text", text: "x", reply: "x" }] }, row()],
    [{ type: "paragraph", parts: [{ type: "button", label: "x", reply: "x", text: "x" }] }],
    [{ type: "paragraph", parts: [{ type: "html", text: "x" }] }, row()], [{ type: "document", url: "file:///private" }],
    [{ type: "button_row", buttons: [{ label: "x", reply: "x", disabled: {} }] }],
    [row(), { ...paragraph("x"), media: [] }], [row(), paragraph("x".repeat(4097))],
    [{ type: "button_row", buttons: [null] }], [row(), null], [row(), { type: "paragraph", parts: [null] }],
    [{ type: "button_row", buttons: [{ label: 1, reply: "x" }] }],
  ];
  for (const value of bad) assert.throws(() => validateEmbeddedContent(value), Error, JSON.stringify(value));
});

test("aggregate context bound includes labels and paragraph and row separators", () => {
  const content = [{ type: "paragraph", parts: [{ type: "text", text: "x".repeat(4095) }, { type: "button", label: "A", reply: "r".repeat(1024) }] }];
  assert.equal(validateEmbeddedContent(content).text.length, 4096);
  assert.throws(() => validateEmbeddedContent([paragraph("x".repeat(4094)), row("A")]), /4096/);
  assert.throws(() => validateEmbeddedContent([{ type: "paragraph", parts: [{ type: "text", text: "x".repeat(4096) }, { type: "button", label: "A", reply: "r" }] }]), /4096/);
  assert.equal(validateEmbeddedContent([{ type: "button_row", buttons: [{ label: "A", reply: "x" }, { label: "B", reply: "y" }] }]).text, "A / B");
  assert.throws(() => validateEmbeddedContent([{ type: "paragraph", parts: [{ type: "button", label: " same ", reply: "a" }] }, row("SAME")]), /distinct/);
});

test("documented maximum block, part and global choice counts are accepted", () => {
  const blocks = Array.from({ length: 15 }, () => ({ type: "paragraph", parts: Array.from({ length: 32 }, () => ({ type: "text", text: " " })) }));
  const prepared = validateEmbeddedContent([...blocks, { type: "button_row", buttons: Array.from({ length: 8 }, (_, i) => ({ label: i === 0 ? "🔎".repeat(32) : String(i), reply: "x".repeat(1024) })) }]);
  assert.equal(prepared.content.length, 16);
  assert.equal(prepared.options.length, 8);
  const last = prepared.active("a".repeat(24)).blocks.at(-1)!;
  assert.equal(last.type, "buttons");
  if (last.type === "buttons") {
    for (const button of last.buttons) {
      assert.ok("callback_data" in button);
      if ("callback_data" in button) assert.ok(Buffer.byteLength(button.callback_data) <= 64);
    }
  }
});

test("embedded validation detaches and freezes nested input before any async work", () => {
  const input: EmbeddedContent = [{ type: "button_row", buttons: [{ label: "Original", reply: "original reply" }] }];
  const prepared = validateEmbeddedContent(input);
  (input[0] as any).buttons[0].label = "Mutated";
  (input[0] as any).buttons[0].reply = "mutated reply";
  input.push({ type: "button_row", buttons: [{ label: "Extra", reply: "extra" }] });
  assert.equal(prepared.options.length, 1);
  assert.equal(prepared.options[0]!.reply, "original reply");
  assert.equal(prepared.text, "Original");
  assert.throws(() => { (prepared.content[0] as any).buttons[0].reply = "bad"; }, TypeError);
  assert.throws(() => { (prepared.disabled.blocks[0] as any).buttons[0].callback_data = "bad"; }, TypeError);
  assert.ok(!JSON.stringify(prepared.active("nonce")).includes("Mutated"));
});
