import { randomUUID } from "node:crypto";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  extractPublicAssistantText,
  getPublicTextPhase,
  type AssistantMessageLike,
} from "./messages.ts";
import { wrapTelegramInput } from "./routing.ts";
import type { TelegramSessionConnection } from "./telegram.ts";

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part) => part?.type === "text")
    .map((part) => part.text)
    .join("\n");
}

interface Origin<T> {
  destination: T;
  admitted: boolean;
}

// A public transport notice is formatting guidance, NOT evidence of origin.
// Only a one-use in-memory receipt, admitted through Pi's extension input source,
// can establish the destination. Receipts do not survive reload/session changes.
export class RequestOrigins<T> {
  private pending = new Map<string, Origin<T>>();
  current?: T;
  enqueue(text: string, destination: T): string {
    if (this.pending.size >= 100)
      throw new Error("Too many pending Telegram requests.");
    const content = `${wrapTelegramInput(text)}\n\n[Pi Telegram request: ${randomUUID()}]`;
    this.pending.set(content, { destination, admitted: false });
    return content;
  }
  admit(text: string, source: string): void {
    const origin = this.pending.get(text);
    if (source !== "extension") {
      this.pending.delete(text);
      return;
    }
    if (origin) origin.admitted = true;
  }
  begin(content: unknown): T | undefined {
    const text = textOf(content);
    const origin = this.pending.get(text);
    this.pending.delete(text);
    this.current = origin?.admitted ? origin.destination : undefined;
    return this.current;
  }
  reset(): void {
    this.pending.clear();
    this.current = undefined;
  }
}

export function registerResponseRouting(
  pi: ExtensionAPI,
  currentConnection: () => TelegramSessionConnection | undefined,
) {
  const origins = new RequestOrigins<TelegramSessionConnection>();
  let latest: AssistantMessageLike | undefined;
  let delivered = false;
  const activeTools = new Map<string, string>();
  let outbound = Promise.resolve();
  const destination = () =>
    origins.current === currentConnection() ? origins.current : undefined;
  const reset = () => {
    origins.reset();
    activeTools.clear();
    latest = undefined;
    delivered = false;
  };
  pi.on("input", (event) => {
    origins.admit(event.text, event.source);
  });
  pi.on("message_start", async (event, ctx) => {
    if (event.message.role === "assistant") {
      try { await destination()?.beginRichDraft(); }
      catch { ctx.ui.notify("Telegram activity draft failed.", "warning"); }
      return;
    }
    if (event.message.role !== "user") return;
    const previous = destination();
    origins.begin(event.message.content);
    latest = undefined;
    delivered = false;
    if (previous !== destination()) {
      activeTools.clear();
      if (previous) await previous.cancelRichDraft();
    }
    const target = destination();
    if (!target) return;
    try {
      await target.beginRichDraft();
    } catch {
      ctx.ui.notify(
        "Telegram activity draft failed; response delivery will still be attempted.",
        "warning",
      );
    }
  });
  pi.on("tool_execution_start", async (event) => {
    if (!destination()) return;
    activeTools.set(event.toolCallId, event.toolName);
    await destination()?.setDraftActivity(event.toolName);
  });
  pi.on("tool_execution_end", async (event) => {
    activeTools.delete(event.toolCallId);
    await destination()?.setDraftActivity([...activeTools.values()].at(-1));
  });
  pi.on("message_update", async (event, ctx) => {
    const target = destination();
    if (
      !target ||
      event.message.role !== "assistant" ||
      event.assistantMessageEvent.type !== "text_delta"
    )
      return;
    const text = extractPublicAssistantText(event.message);
    if (!text) return;
    try {
      if (getPublicTextPhase(event.message) === "commentary")
        await target.streamCommentaryDraft(text);
      else if (getPublicTextPhase(event.message) === "final_answer")
        await target.streamRichDraft(text);
    } catch {
      ctx.ui.notify("Telegram draft streaming failed.", "warning");
    }
  });
  pi.on("message_end", async (event, ctx) => {
    const target = destination();
    if (!target || event.message.role !== "assistant") return;
    const text = extractPublicAssistantText(event.message);
    if (!text) return;
    latest = event.message;
    const stopReason = event.message.stopReason;
    delivered = false;
    outbound = outbound.then(async () => {
      if (destination() !== target) return;
      try {
        if (stopReason === "toolUse") await target.updateRichDraft(text);
        else if (stopReason === "stop" || stopReason === "length") {
          await target.sendRichMessage(text);
          delivered = true;
          // A completed message is not necessarily a settled request (e.g.
          // automatic compaction or a length-limit retry). Keep activity alive.
          if (destination() === target) {
            try { await target.beginRichDraft(); }
            catch { ctx.ui.notify("Telegram continuation activity draft failed.", "warning"); }
          }
        }
      } catch {
        ctx.ui.notify("Telegram response delivery failed.", "warning");
      }
    });
    await outbound;
  });
  pi.on("agent_settled", async (_event, ctx) => {
    const target = destination();
    await outbound;
    // Retry only this request's completed response, never an older transcript entry.
    try {
      if (
        target &&
        !delivered &&
        (latest?.stopReason === "stop" || latest?.stopReason === "length")
      ) {
        const text = extractPublicAssistantText(latest);
        if (text && destination() === target)
          await target.sendRichMessage(text);
      }
    } catch {
      ctx.ui.notify("Telegram final response retry failed.", "warning");
    } finally {
      if (target) await target.cancelRichDraft();
      origins.current = undefined;
      activeTools.clear();
      latest = undefined;
    }
  });
  return { origins, destination, reset };
}
