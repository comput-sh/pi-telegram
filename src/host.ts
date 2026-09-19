import { execFile } from "node:child_process";
import { hostname, networkInterfaces } from "node:os";

export interface HostIdentity {
  hostname: string;
  ip: string;
}

export interface SessionStartupDetails extends HostIdentity {
  projectName: string;
  branch?: string;
  version?: string;
}

function isPrivateIpv4(address: string): boolean {
  if (address.startsWith("10.") || address.startsWith("192.168.")) return true;
  const match = /^172\.(\d+)\./.exec(address);
  const second = match ? Number.parseInt(match[1]!, 10) : -1;
  return second >= 16 && second <= 31;
}

export async function getGitBranch(cwd: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile(
      "git",
      ["rev-parse", "--abbrev-ref", "HEAD"],
      { cwd, encoding: "utf8", timeout: 3_000, windowsHide: true },
      (error, stdout) => {
        if (error) {
          resolve(undefined);
          return;
        }
        const branch = stdout.trim();
        resolve(branch && branch !== "HEAD" ? branch : undefined);
      },
    );
  });
}

function formatSessionMessage(
  title: string,
  details: SessionStartupDetails,
): string {
  return [
    title,
    `Project: ${details.projectName}`,
    ...(details.branch ? [`Branch: ${details.branch}`] : []),
    `Host: ${details.hostname} (${details.ip})`,
    "",
    "Normal messages: follow-up",
    "Prefix !: steer active work",
    "Prefix !!: send a literal leading !",
    "Send stop: cancel the current Telegram task",
  ].join("\n");
}

export function formatSessionStartupMessage(
  details: SessionStartupDetails,
): string {
  return `Connected · ${details.projectName} · ${details.ip}${details.version ? ` · v${details.version}` : ""}`;
}

export function formatSessionStatusMessage(
  details: SessionStartupDetails,
): string {
  return formatSessionMessage("Pi Telegram session status", details);
}

export function getHostIdentity(): HostIdentity {
  const addresses = Object.values(networkInterfaces())
    .flatMap((entries) => entries ?? [])
    .filter((entry) => entry.family === "IPv4" && !entry.internal)
    .map((entry) => entry.address);
  return {
    hostname: hostname(),
    ip: addresses.find(isPrivateIpv4) ?? addresses[0] ?? "unknown",
  };
}
