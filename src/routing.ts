export const TELEGRAM_INPUT_NOTICE =
  "[Message from Telegram. Public progress and the final response will be sent back through Telegram Rich Messages. During tool work, emit concise single-line public progress updates at meaningful milestones so the user can follow along; keep hidden reasoning private and never include raw tool details. Format the final response as valid Telegram Rich Markdown (GitHub-Flavored Markdown where possible). Use native headings, lists, tables, links, quotes, code blocks, details, footnotes, and LaTeX when they improve clarity.]";

export interface TelegramInputRoute {
  text: string;
  deliverAs: "steer" | "followUp";
}

export function routeTelegramInput(message: string): TelegramInputRoute {
  if (message.startsWith("!!")) {
    return { text: message.slice(1), deliverAs: "followUp" };
  }
  if (message.startsWith("!") && message.length > 1) {
    return { text: message.slice(1).trimStart(), deliverAs: "steer" };
  }
  return { text: message, deliverAs: "followUp" };
}

export function wrapTelegramInput(message: string): string {
  return `${TELEGRAM_INPUT_NOTICE}\n\n${message}`;
}

export function isTelegramInput(content: unknown): boolean {
  if (typeof content === "string") {
    return content.startsWith(TELEGRAM_INPUT_NOTICE);
  }
  if (!Array.isArray(content)) return false;
  const text = content
    .filter(
      (part): part is { type: "text"; text: string } =>
        !!part &&
        typeof part === "object" &&
        (part as { type?: unknown }).type === "text" &&
        typeof (part as { text?: unknown }).text === "string",
    )
    .map((part) => part.text)
    .join("\n");
  return text.startsWith(TELEGRAM_INPUT_NOTICE);
}
