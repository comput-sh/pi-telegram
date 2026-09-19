import { readFileSync, realpathSync } from "node:fs";
import { realpath, readFile, access } from "node:fs/promises";
import { dirname, join, resolve, delimiter, basename } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { withPrivateLock, assertLocksHealthy } from "./locks.ts";

export const PACKAGE_NAME = "@comput/pi-telegram";
export interface RunningPackage { version: string; root: string }

// Called once per extension factory: never reread the version for startup messages.
export function runningPackage(): RunningPackage {
  const root = realpathSync(fileURLToPath(new URL("..", import.meta.url)));
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  if (pkg.name !== PACKAGE_NAME || !stableVersion(pkg.version))
    throw new Error("Invalid Pi Telegram package identity.");
  return { root, version: pkg.version };
}

export function stableVersion(value: unknown): value is string {
  return typeof value === "string" && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value) && value.length < 40;
}
export function newerVersion(candidate: string, current: string): boolean {
  if (!stableVersion(candidate) || !stableVersion(current)) return false;
  const a = candidate.split(".").map(BigInt), b = current.split(".").map(BigInt);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i]! > b[i]!;
  return false;
}

export async function latestVersion(signal: AbortSignal): Promise<string | undefined> {
  if (process.env.PI_OFFLINE && !/^(0|false|no)$/i.test(process.env.PI_OFFLINE)) return undefined;
  try {
    const response = await fetch("https://registry.npmjs.org/@comput%2fpi-telegram/latest", {
      signal: AbortSignal.any([signal, AbortSignal.timeout(8_000)]),
      redirect: "error",
    });
    if (!response.ok) return undefined;
    const pkg = await response.json() as { name?: string; version?: string };
    return pkg.name === PACKAGE_NAME && stableVersion(pkg.version) ? pkg.version : undefined;
  } catch { return undefined; }
}

/** Only recognized Pi npm installs; never replace source, Git, or symlinked checkouts. */
export async function installPrefix(root: string, cwd: string): Promise<string | undefined> {
  const agent = resolve(process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent"));
  if (await access(join(root, ".git")).then(() => true, () => false)) return undefined;
  // Custom package managers and explicitly pinned sources require local management.
  for (const path of [join(agent, "settings.json"), join(resolve(cwd), ".pi", "settings.json")]) {
    let settings;
    try { settings = JSON.parse(await readFile(path, "utf8")); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; return undefined; }
    if (settings.npmCommand) return undefined;
    if (Array.isArray(settings.packages) && settings.packages.some((entry: unknown) => {
      const source = typeof entry === "string" ? entry : (entry as { source?: unknown } | null)?.source;
      return typeof source === "string" && source.startsWith(`npm:${PACKAGE_NAME}@`);
    })) return undefined;
  }
  for (const prefix of [join(agent, "npm"), join(resolve(cwd), ".pi", "npm")]) {
    const expected = join(prefix, "node_modules", "@comput", "pi-telegram");
    const canonical = await realpath(expected).catch(() => undefined);
    const canonicalPrefix = await realpath(prefix).catch(() => undefined);
    if (canonical && canonicalPrefix && canonical === root &&
        canonical === join(canonicalPrefix, "node_modules", "@comput", "pi-telegram")) return canonicalPrefix;
  }
  return undefined;
}

export async function applyUpdateWhenIdle(signal: AbortSignal, work: {
  waitForIdle(): Promise<void>;
  isCurrent(): boolean;
  install(): Promise<void>;
  reload(): Promise<void>;
}): Promise<void> {
  await work.waitForIdle();
  if (signal.aborted || !work.isCurrent()) return;
  await work.install();
  if (signal.aborted || !work.isCurrent()) return;
  await work.reload();
}

export async function findNpmCli(): Promise<string> {
  const directories = [dirname(process.execPath), ...(process.env.PATH || process.env.Path || "").split(delimiter).filter(Boolean)];
  for (const directory of directories) {
    const base = directory.replace(/^"|"$/g, "");
    const script = join(base, "node_modules", "npm", "bin", "npm-cli.js");
    if (await access(script).then(() => true, () => false)) return script;
    const executable = await realpath(join(base, "npm")).catch(() => undefined);
    if (executable && basename(executable) === "npm-cli.js") return executable;
  }
  throw new Error("npm CLI could not be found. Update locally.");
}

export interface UpdateExecutor {
  (command: string, args: string[], options: { signal: AbortSignal; timeout: number; cwd: string }): Promise<{ code: number; killed?: boolean }>;
}

export async function installUpdate(running: RunningPackage, version: string, cwd: string, signal: AbortSignal, exec: UpdateExecutor): Promise<void> {
  if (!newerVersion(version, running.version)) throw new Error("Invalid update version.");
  const prefix = await installPrefix(running.root, cwd);
  if (!prefix) throw new Error("This installation must be updated locally.");
  await withPrivateLock(join(prefix, ".pi-telegram-update"), "Another session is installing an update. Try again later.", async () => {
    signal.throwIfAborted();
    if (await installPrefix(running.root, cwd) !== prefix) throw new Error("Installation changed.");
    const installed = JSON.parse(await readFile(join(running.root, "package.json"), "utf8"));
    if (installed.name !== PACKAGE_NAME || !stableVersion(installed.version)) throw new Error("Invalid installed package.");
    if (installed.version === version) return; // Another session already installed this offer.
    if (installed.version !== running.version) throw new Error("Installed version changed. Reload and check for updates again.");
    assertLocksHealthy();
    const cli = await findNpmCli();
    signal.throwIfAborted();
    const result = await exec(process.execPath, [cli, "install", "--prefix", prefix, "--save-exact", "--legacy-peer-deps", "--omit=dev", "--no-audit", "--no-fund", "--registry=https://registry.npmjs.org", `${PACKAGE_NAME}@${version}`], { signal, timeout: 300_000, cwd: prefix });
    signal.throwIfAborted();
    assertLocksHealthy();
    if (result.code !== 0 || result.killed) throw new Error("Installation failed. Inspect or repair the package locally before retrying.");
    const updated = JSON.parse(await readFile(join(running.root, "package.json"), "utf8"));
    if (updated.name !== PACKAGE_NAME || updated.version !== version) throw new Error("Installed version could not be verified.");
  });
}
