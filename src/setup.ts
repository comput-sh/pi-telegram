import type {
  ExtensionContext,
  ExtensionUIContext,
} from "@earendil-works/pi-coding-agent";

import {
  getGlobalSettingsPath,
  getProjectSettingsPath,
  loadGlobalSettings,
  loadProjectSettings,
  normalizeBotUsername,
  saveGlobalSettings,
  saveProjectSettings,
  type GlobalSettings,
  type ProjectBotSettings,
} from "./config.ts";
import { pairManualBot, validateBotToken } from "./bot-api.ts";

const MANAGER_OPTION = "Yes — configure a Telegram manager bot";
const MANUAL_OPTION = "No — I will provide each project bot manually";

function truncate(value: string, width: number): string {
  if (width <= 0) return "";
  return value.length <= width ? value : `${value.slice(0, Math.max(0, width - 1))}…`;
}

export async function promptSecret(
  ui: ExtensionUIContext,
  title: string,
): Promise<string | undefined> {
  return ui.custom<string | undefined>((tui, _theme, _keybindings, done) => {
    let value = "";
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
          done(value.trim() || undefined);
          return;
        }
        if (data === "\x1b" || data === "\x03") {
          done(undefined);
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
): Promise<{ username: string; token: string } | undefined> {
  const usernameInput = await ui.input(
    kind === "manager" ? "Manager bot username" : "Project bot username",
    "@exampleBot",
  );
  if (!usernameInput?.trim()) return undefined;
  const username = normalizeBotUsername(usernameInput);
  const token = await promptSecret(
    ui,
    kind === "manager" ? `Token for @${username}` : `Token for @${username}`,
  );
  return token ? { username, token } : undefined;
}

export async function configureManager(
  ctx: ExtensionContext,
): Promise<GlobalSettings | undefined> {
  const credentials = await promptBotCredentials(ctx.ui, "manager");
  if (!credentials) return undefined;
  const identity = await validateBotToken(
    credentials.token,
    credentials.username,
    true,
    AbortSignal.timeout(20_000),
  );
  const settings: GlobalSettings = {
    version: 1,
    provisioningMode: "manager",
    manager: {
      id: identity.id,
      username: identity.username,
      token: credentials.token.trim(),
    },
  };
  await saveGlobalSettings(settings);
  ctx.ui.notify(
    `Manager bot @${identity.username} saved in ${getGlobalSettingsPath()}`,
    "info",
  );
  return settings;
}

export async function configureManualProjectBot(
  ctx: ExtensionContext,
): Promise<ProjectBotSettings | undefined> {
  const credentials = await promptBotCredentials(ctx.ui, "project");
  if (!credentials) return undefined;
  let pairingCode: string | undefined;
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new Error("Telegram owner pairing timed out after three minutes.")),
    180_000,
  );
  try {
    const settings = await pairManualBot(
      credentials.token,
      credentials.username,
      (code) => {
        pairingCode = code;
        ctx.ui.notify(
          `Open @${credentials.username} in Telegram, press Start, and send this exact pairing code within three minutes: ${code}`,
          "info",
        );
      },
      controller.signal,
    );
    await saveProjectSettings(ctx.cwd, settings);
    ctx.ui.notify(
      `@${settings.username} is configured for this project in ${getProjectSettingsPath(ctx.cwd)}.`,
      "info",
    );
    return settings;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      pairingCode ? `Pairing with @${credentials.username} failed: ${message}` : message,
      { cause: error },
    );
  } finally {
    clearTimeout(timeout);
  }
}

export async function ensureInitialConfiguration(
  ctx: ExtensionContext,
): Promise<{
  global?: GlobalSettings;
  project?: ProjectBotSettings;
}> {
  let global = await loadGlobalSettings();
  if (!global) {
    const selected = await ctx.ui.select(
      "Do you have a Telegram manager bot that can create managed bots?",
      [MANAGER_OPTION, MANUAL_OPTION],
    );
    if (selected === MANAGER_OPTION) {
      global = await configureManager(ctx);
    } else if (selected === MANUAL_OPTION) {
      global = { version: 1, provisioningMode: "manual" };
      await saveGlobalSettings(global);
      ctx.ui.notify(
        `Manual provisioning mode saved in ${getGlobalSettingsPath()}.`,
        "info",
      );
    }
  }

  let project = await loadProjectSettings(ctx.cwd);
  if (global?.provisioningMode === "manual" && !project) {
    project = await configureManualProjectBot(ctx);
  }
  return { global, project };
}
