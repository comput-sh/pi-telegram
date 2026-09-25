import type {
  ExtensionContext,
  ExtensionUIContext,
} from "@earendil-works/pi-coding-agent";

import {
  getGlobalSettingsPath,
  loadGlobalSettings,
  normalizeBotUsername,
  saveGlobalSettings,
  withManagerLock,
  type GlobalSettings,
} from "./config.ts";
import {
  pairManualBot,
  validateBotToken,
  type ConfiguredProjectBot,
} from "./bot-api.ts";

function truncate(value: string, width: number): string {
  if (width <= 0) return "";
  return value.length <= width
    ? value
    : `${value.slice(0, Math.max(0, width - 1))}…`;
}

export async function promptSecret(
  ui: ExtensionUIContext,
  title: string,
  signal?: AbortSignal,
): Promise<string | undefined> {
  signal?.throwIfAborted();
  return ui.custom<string | undefined>((tui, _theme, _keybindings, done) => {
    let value = "";
    let finished = false;
    const finish = (result: string | undefined) => {
      if (finished) return;
      finished = true;
      signal?.removeEventListener("abort", abort);
      value = "";
      done(result);
    };
    const abort = () => finish(undefined);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) queueMicrotask(abort);
    return {
      render(width: number): string[] {
        const count = Math.min(value.length, Math.max(0, width - 2));
        return [
          truncate(title, width),
          truncate(`› ${"•".repeat(count)}`, width),
          truncate("Enter to save • Esc to cancel • input is hidden", width),
        ];
      },
      handleInput(data: string): void {
        if (data === "\r" || data === "\n") {
          finish(value.trim() || undefined);
          return;
        }
        if (data === "\x1b" || data === "\x03") {
          finish(undefined);
          return;
        }
        if (data === "\x7f" || data === "\b") {
          value = Array.from(value).slice(0, -1).join("");
          tui.requestRender();
          return;
        }
        if (data.startsWith("\x1b[200~")) {
          data = data.slice(6).replace(/\x1b\[201~$/, "");
        } else if (data.startsWith("\x1b")) {
          return;
        }
        const tokenCharacters = data.replace(/[^A-Za-z0-9:_-]/g, "");
        if (tokenCharacters) {
          value += tokenCharacters;
          tui.requestRender();
        }
      },
      invalidate(): void {},
    };
  });
}

async function promptBotCredentials(
  ui: ExtensionUIContext,
  kind: "manager" | "project",
  signal?: AbortSignal,
): Promise<{ username: string; token: string } | undefined> {
  const usernameInput = await ui.input(
    kind === "manager" ? "Manager bot username" : "Bot username",
    "@exampleBot",
    { signal },
  );
  if (!usernameInput?.trim()) return undefined;
  const username = normalizeBotUsername(usernameInput);
  const token = await promptSecret(ui, `Token for @${username}`, signal);
  signal?.throwIfAborted();
  return token ? { username, token } : undefined;
}

export async function configureManager(
  ctx: ExtensionContext,
  signal: AbortSignal = AbortSignal.timeout(180_000),
): Promise<GlobalSettings | undefined> {
  if (ctx.mode !== "tui")
    throw new Error("Masked token entry requires local Pi UI.");
  const snapshot = await loadGlobalSettings();
  const credentials = await promptBotCredentials(ctx.ui, "manager", signal);
  if (!credentials) return undefined;
  const identity = await validateBotToken(
    credentials.token,
    credentials.username,
    true,
    AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
  );
  const confirmed = await ctx.ui.confirm(
    `Use @${identity.username} as the manager bot?`,
    "Managed-bot setup uses local getUpdates polling and will remove any webhook currently configured for this manager bot.",
    { signal },
  );
  if (!confirmed) return undefined;

  return withManagerLock(async () => {
    signal.throwIfAborted();
    const previous = await loadGlobalSettings();
    if (JSON.stringify(previous) !== JSON.stringify(snapshot))
      throw new Error(
        "Manager settings changed during setup. Please review them again.",
      );
    const previousManager =
      previous?.provisioningMode === "manager" &&
      previous.manager.id === identity.id
        ? previous.manager
        : undefined;
    const settings: GlobalSettings = {
      version: 1,
      provisioningMode: "manager",
      manager: {
        id: identity.id,
        username: identity.username,
        token: credentials.token.trim(),
        ...(previousManager?.updateOffset === undefined
          ? {}
          : { updateOffset: previousManager.updateOffset }),
        ...(previousManager?.pending
          ? { pending: previousManager.pending }
          : {}),
        ...(previousManager?.knownBots
          ? { knownBots: previousManager.knownBots }
          : {}),
      },
    };
    await saveGlobalSettings(settings);
    ctx.ui.notify(
      `Manager bot @${identity.username} saved in ${getGlobalSettingsPath()}`,
      "info",
    );
    return settings;
  });
}

// Usernames and pairing codes are validated ASCII. Wrap rather than truncate:
// even a terminal narrower than the code must retain every character.
export function renderPairingInstructions(
  username: string,
  code: string | undefined,
  width: number,
): string[] {
  if (width < 1) return [];
  const paragraphs = code
    ? [
        "Open the private Telegram chat:",
        `@${username}`,
        "Press Start, then send this code as one line:",
        code,
      ]
    : ["Preparing private owner pairing for", `@${username}`];
  paragraphs.push("Esc: cancel pairing", "Expires after three minutes.");
  return paragraphs.flatMap((text) => {
    const lines: string[] = [];
    while (text.length > width) {
      const space = text.lastIndexOf(" ", width);
      const end = space > 0 ? space : width;
      lines.push(text.slice(0, end));
      text = text.slice(end).trimStart();
    }
    if (text) lines.push(text);
    return lines;
  });
}

export async function pairProjectBotOwner(
  ctx: ExtensionContext,
  token: string,
  username: string,
  signal?: AbortSignal,
): Promise<ConfiguredProjectBot> {
  const controller = new AbortController();
  const combined = AbortSignal.any([
    controller.signal,
    ...(signal ? [signal] : []),
    AbortSignal.timeout(180_000),
  ]);
  combined.throwIfAborted();
  let failure: unknown;
  const paired = await ctx.ui.custom<ConfiguredProjectBot | undefined>(
    (tui, _theme, _keys, done) => {
      let pairingCode: string | undefined;
      // Close only after polling settles, so callers cannot release the lease
      // while the cancelled getUpdates request is still in flight.
      void pairManualBot(
        token,
        username,
        (code) => {
          pairingCode = code;
          tui.requestRender();
        },
        combined,
      ).then(done, (error) => {
        failure = error;
        done(undefined);
      });
      return {
        render: (width: number) =>
          renderPairingInstructions(username, pairingCode, width),
        handleInput: (data: string) => {
          if (data === "\x1b" || data === "\x03")
            controller.abort(new Error("Telegram pairing cancelled."));
        },
        invalidate() {},
      };
    },
  );
  if (!paired) throw failure ?? new Error("Telegram pairing cancelled.");
  combined.throwIfAborted();
  return paired;
}

export async function promptProjectBot(
  ctx: ExtensionContext,
  signal: AbortSignal,
): Promise<{ id: string; username: string; token: string } | undefined> {
  if (ctx.mode !== "tui")
    throw new Error("Masked token entry requires local Pi UI.");
  const credentials = await promptBotCredentials(ctx.ui, "project", signal);
  if (!credentials) return undefined;
  const identity = await validateBotToken(
    credentials.token,
    credentials.username,
    false,
    AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
  );
  signal.throwIfAborted();
  return {
    id: identity.id,
    username: identity.username,
    token: credentials.token,
  };
}
