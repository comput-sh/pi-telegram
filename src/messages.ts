export interface AssistantMessageLike {
  role?: string;
  content?: unknown;
  stopReason?: string;
  timestamp?: number;
}

export type PublicTextPhase = "commentary" | "final_answer";

export interface SessionEntryLike {
  id: string;
  type: string;
  message?: AssistantMessageLike;
}

export function extractPublicAssistantText(
  message: AssistantMessageLike,
): string | undefined {
  if (message.role !== "assistant" || !Array.isArray(message.content)) return;
  const text = message.content
    .filter(
      (part): part is { type: "text"; text: string } =>
        !!part &&
        typeof part === "object" &&
        (part as { type?: unknown }).type === "text" &&
        typeof (part as { text?: unknown }).text === "string",
    )
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join("\n\n");
  return text || undefined;
}

export function getPublicTextPhase(
  message: AssistantMessageLike,
): PublicTextPhase | undefined {
  if (!Array.isArray(message.content)) return;
  for (let index = message.content.length - 1; index >= 0; index -= 1) {
    const part = message.content[index];
    if (
      !part ||
      typeof part !== "object" ||
      (part as { type?: unknown }).type !== "text" ||
      typeof (part as { textSignature?: unknown }).textSignature !== "string"
    ) {
      continue;
    }
    try {
      const phase = JSON.parse(
        (part as { textSignature: string }).textSignature,
      ) as { phase?: unknown };
      if (phase.phase === "commentary" || phase.phase === "final_answer") {
        return phase.phase;
      }
    } catch {
      return;
    }
  }
  return;
}

export function findLatestAssistantText(
  entries: readonly SessionEntryLike[],
): { entryId: string; messageTimestamp?: number; text: string } | undefined {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry?.type !== "message" || !entry.message) continue;
    const text = extractPublicAssistantText(entry.message);
    if (text) {
      return {
        entryId: entry.id,
        messageTimestamp: entry.message.timestamp,
        text,
      };
    }
  }
  return undefined;
}

export function splitTelegramText(text: string, limit = 4000): string[] {
  if (text.length <= limit) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > limit) {
    const newline = remaining.lastIndexOf("\n", limit);
    const space = remaining.lastIndexOf(" ", limit);
    const splitAt = Math.max(newline, space, 1);
    chunks.push(remaining.slice(0, splitAt).trimEnd());
    remaining = remaining.slice(splitAt).trimStart();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}
