import { randomUUID } from "node:crypto";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { wrapTelegramInput } from "./routing.ts";
import type { TelegramSessionConnection } from "./telegram.ts";

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter(part => part?.type === "text").map(part => part.text).join("\n");
}
interface Origin<T> { destination: T; admitted: boolean }

// The public transport prefix is guidance, not authentication. Only a one-use
// receipt admitted through extension input can establish inbound provenance.
export class RequestOrigins<T> {
  private pending = new Map<string, Origin<T>>();
  current?: T;
  private retired = new Set<string>();
  private currentText?: string;
  invalidated = false;
  enqueue(text: string, destination: T): string {
    if (this.pending.size >= 100) throw new Error("Too many pending Telegram requests.");
    const content = `${wrapTelegramInput(text)}\n\n[Pi Telegram request: ${randomUUID()}]`;
    this.pending.set(content, { destination, admitted: false });
    return content;
  }
  admit(text: string, source: string): void {
    const origin = this.pending.get(text);
    if (source !== "extension") { this.pending.delete(text); return; }
    if (origin) origin.admitted = true;
  }
  begin(content: unknown): T | undefined {
    const text = textOf(content);
    const origin = this.pending.get(text);
    this.pending.delete(text);
    this.invalidated = this.retired.has(text);
    this.currentText = origin?.admitted ? text : undefined;
    this.current = origin?.admitted ? origin.destination : undefined;
    return this.current;
  }
  reset(): void {
    for (const text of this.pending.keys()) this.retired.add(text);
    if (this.currentText) this.retired.add(this.currentText);
    this.pending.clear(); this.current = undefined; this.currentText = undefined;
  }
}

/** Inbound provenance only. No public-text mirroring, drafts or tool tracking. */
export function registerResponseRouting(pi: ExtensionAPI, currentConnection: () => TelegramSessionConnection | undefined) {
  const origins = new RequestOrigins<TelegramSessionConnection>();
  let invalidatedRequest = false;
  const destination = () => origins.current === currentConnection() ? origins.current : undefined;
  const outboundDestination = () => {
    if (invalidatedRequest || (origins.current && origins.current !== currentConnection())) return undefined;
    return currentConnection();
  };
  const reset = () => {
    invalidatedRequest ||= !!origins.current;
    origins.reset();
  };
  pi.on("input", event => { origins.admit(event.text, event.source); });
  pi.on("message_start", event => {
    if (event.message.role !== "user") return;
    origins.begin(event.message.content);
    invalidatedRequest = origins.invalidated;
  });
  pi.on("agent_settled", () => {
    origins.current = undefined;
    invalidatedRequest = false;
  });
  return { origins, destination, outboundDestination, reset };
}
