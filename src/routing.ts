export const TELEGRAM_INPUT_NOTICE =
  "[Message from Telegram. Use telegram_post for replies and progress; telegram_draft for explicit previews, telegram_edit for returned message references, and telegram_activity for Working/clear. Ordinary assistant text is not forwarded. During tool work, send concise progress updates at meaningful milestones. Keep hidden reasoning and raw tool details private. Format messages using Telegram Rich Markdown (GitHub-Flavored Markdown where possible). Use headings, lists, tables, links, quotes, code blocks, collapsible details, footnotes, and LaTeX when they improve clarity. Choose the formatting that best fits the response; short replies can remain simple text.]";

export interface TelegramInputRoute {
  text: string;
  deliverAs: "steer" | "followUp";
}

export function routeTelegramInput(message: string, busy = false): TelegramInputRoute {
  return { text: message, deliverAs: busy ? "steer" : "followUp" };
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
