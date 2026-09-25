/** Narrow, model-facing embedded controls; never arbitrary Telegram blocks. */
export type EmbeddedChoice = { label: string; reply: string };
export type EmbeddedPart = { type: "text"; text: string } | ({ type: "button" } & EmbeddedChoice);
export type EmbeddedContent = Array<
  | { type: "paragraph"; parts: EmbeddedPart[] }
  | { type: "button_row"; buttons: EmbeddedChoice[] }
>;

type RichButton = { text: string; callback_data: string } | { text: string; disabled: Record<string, never> };
export type EmbeddedRichMessage = {
  blocks: Array<
    | { type: "paragraph"; text: Array<string | { type: "button"; button: RichButton }> }
    | { type: "buttons"; buttons: RichButton[] }
  >;
  skip_entity_detection: true;
};
export interface PreparedEmbeddedContent {
  content: EmbeddedContent;
  text: string;
  options: EmbeddedChoice[];
  disabled: EmbeddedRichMessage;
  active(nonce: string): EmbeddedRichMessage;
}

function object(value: unknown, fields: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !fields.includes(key)))
    throw new Error("Embedded content contains unsupported fields or an invalid object.");
  return value as Record<string, unknown>;
}
function list(value: unknown, max: number, label: string): unknown[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > max)
    throw new Error(`${label} requires 1–${max} entries.`);
  return value;
}
function string(value: unknown, max: number, label: string, nonblank = true): string {
  if (typeof value !== "string" || !value.length || value.length > max || (nonblank && !value.trim()))
    throw new Error(`${label} must be ${nonblank ? "nonblank " : ""}text of at most ${max} characters.`);
  return value;
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

/** Validate and detach all caller-owned data synchronously, before queue admission. */
export function validateEmbeddedContent(input: unknown): PreparedEmbeddedContent {
  const options: EmbeddedChoice[] = [];
  const choice = (input: Record<string, unknown>): EmbeddedChoice => {
    const result = { label: string(input.label, 64, "Button label"), reply: string(input.reply, 1024, "Button reply") };
    options.push(result);
    return result;
  };
  const content: EmbeddedContent = list(input, 16, "Embedded content").map(value => {
    const block = object(value, ["type", "parts", "buttons"]);
    if (block.type === "paragraph") {
      object(value, ["type", "parts"]);
      return { type: "paragraph", parts: list(block.parts, 32, "Paragraph parts").map(value => {
        const part = object(value, ["type", "text", "label", "reply"]);
        if (part.type === "text") {
          object(value, ["type", "text"]);
          return { type: "text", text: string(part.text, 4096, "Text part", false) };
        }
        if (part.type === "button") {
          object(value, ["type", "label", "reply"]);
          return { type: "button", ...choice(part) };
        }
        throw new Error("Embedded paragraph parts must be text or button.");
      }) };
    }
    if (block.type === "button_row") {
      object(value, ["type", "buttons"]);
      return { type: "button_row", buttons: list(block.buttons, 8, "Button row").map(value => choice(object(value, ["label", "reply"]))) };
    }
    throw new Error("Embedded blocks must be paragraph or button_row.");
  });
  if (options.length < 1 || options.length > 8) throw new Error("Embedded content requires 1–8 buttons in total.");
  if (new Set(options.map(o => o.label.trim().toLowerCase())).size !== options.length)
    throw new Error("Embedded button labels must be distinct across the entire message.");
  const text = content.map(block => block.type === "paragraph"
    ? block.parts.map(part => part.type === "text" ? part.text : part.label).join("")
    : block.buttons.map(button => button.label).join(" / ")).join("\n\n");
  if (text.length > 4096) throw new Error("Embedded content including button labels and question-context separators must not exceed 4096 characters.");
  freeze(content); freeze(options);
  const compile = (nonce?: string): EmbeddedRichMessage => {
    let index = 0;
    const button = ({ label }: EmbeddedChoice): RichButton => nonce === undefined
      ? { text: label, disabled: {} }
      : { text: label, callback_data: `ask:${nonce}:${index++}` };
    return freeze({
      blocks: content.map(block => block.type === "paragraph"
        ? { type: "paragraph", text: block.parts.map(part => part.type === "text" ? part.text : { type: "button", button: button(part) }) }
        : { type: "buttons", buttons: block.buttons.map(button) }),
      skip_entity_detection: true,
    });
  };
  return Object.freeze({ content, text, options, disabled: compile(), active: (nonce: string) => compile(nonce) });
}
