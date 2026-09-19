import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { withPrivateLock } from "./locks.ts";

export const INCOMING_FILE_LIMIT = 20 * 1024 * 1024;
export const INBOX_BYTE_LIMIT = 100 * 1024 * 1024;
export const INBOX_FILE_LIMIT = 100;
const exec = promisify(execFile);
export interface IncomingAttachment {
  fileId: string;
  fileName: string;
  size?: number;
  kind: "document" | "photo";
}

export function safeIncomingName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-96) || "attachment.bin";
}

async function plainDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Inbox must not use symbolic paths.");
}

async function prepareInbox(root: string): Promise<string> {
  await plainDirectory(join(root, ".pi"));
  const inbox = join(root, ".pi", "telegram-inbox");
  await plainDirectory(inbox);
  if (await realpath(inbox) !== inbox) throw new Error("Inbox path changed.");
  const ignore = join(inbox, ".gitignore");
  try { await writeFile(ignore, "*\n!.gitignore\n", { flag: "wx", mode: 0o600 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  const stat = await lstat(ignore);
  if (!stat.isFile() || stat.isSymbolicLink() || await readFile(ignore, "utf8") !== "*\n!.gitignore\n")
    throw new Error("Inbox Git-ignore safeguards need local repair.");
  return inbox;
}

async function checkGit(root: string, inbox: string, destination: string): Promise<void> {
  const options = { cwd: root, windowsHide: true, timeout: 5_000 };
  try { await exec("git", ["rev-parse", "--show-toplevel"], options); }
  catch (error) {
    if (/not a git repository/i.test(String((error as { stderr?: string }).stderr))) return;
    throw new Error("Unable to verify inbox Git safety.");
  }
  const tracked = await exec("git", ["ls-files", "--", relative(root, inbox).replace(/\\/g, "/")], options);
  if (tracked.stdout.split(/\r?\n/).some(line => line && !line.endsWith("/.gitignore")))
    throw new Error("Inbox contains Git-tracked files. Remove them from the index locally before receiving files.");
  try { await exec("git", ["check-ignore", "-q", "--", destination], options); }
  catch { throw new Error("Inbox is not ignored by Git."); }
}

/** Stream untrusted bytes to an inert inbox, never parse/execute/extract uploads. */
export async function receiveProjectAttachment(
  cwd: string,
  attachment: IncomingAttachment,
  signal: AbortSignal,
  download: () => Promise<Response>,
): Promise<{ path: string; size: number }> {
  signal.throwIfAborted();
  if (attachment.size !== undefined && (!Number.isSafeInteger(attachment.size) || attachment.size < 0 || attachment.size > INCOMING_FILE_LIMIT))
    throw new Error("Incoming files must not exceed 20 MB.");
  const root = await realpath(cwd);
  const inbox = await prepareInbox(root);
  return withPrivateLock(join(inbox, ".receive"), "Another file is being received in this project. Try again shortly.", async () => {
    await prepareInbox(root);
    let used = 0, count = 0;
    for (const name of await readdir(inbox)) {
      if (name === ".gitignore" || name === ".receive.guard") continue;
      const info = await lstat(join(inbox, name));
      if (!info.isFile() || info.isSymbolicLink()) throw new Error("Unexpected inbox entries require local inspection.");
      count++; used += info.size;
    }
    if (count >= INBOX_FILE_LIMIT || used >= INBOX_BYTE_LIMIT) throw new Error("Telegram inbox is full. Remove unneeded inbox files locally (100 files / 100 MB limit).");
    const remaining = Math.min(INCOMING_FILE_LIMIT, INBOX_BYTE_LIMIT - used);
    if (attachment.size !== undefined && attachment.size > remaining) throw new Error("Not enough Telegram inbox space. Remove unneeded files locally.");
    const destination = join(inbox, `${randomUUID()}-${safeIncomingName(attachment.fileName)}`);
    const temporary = `${destination}.part`;
    await checkGit(root, inbox, temporary);
    signal.throwIfAborted();
    const response = await download();
    if (!response.ok || !response.body) throw new Error("Telegram file download failed.");
    const reader = response.body.getReader();
    let size = 0;
    const abort = () => { void reader.cancel().catch(() => undefined); };
    signal.addEventListener("abort", abort, { once: true });
    try {
      signal.throwIfAborted();
      const handle = await open(temporary, "wx", 0o600);
      try {
        for (;;) {
          const { done, value } = await reader.read();
          signal.throwIfAborted();
          if (done) break;
          size += value.byteLength;
          if (size > remaining) throw new Error("Download exceeds the 20 MB file limit or available inbox space.");
          await handle.writeFile(value);
        }
        if (attachment.size !== undefined && size !== attachment.size) throw new Error("Incomplete Telegram file download; please resend.");
        await handle.sync();
      } finally { await handle.close(); }
      signal.throwIfAborted();
      await prepareInbox(root);
      await checkGit(root, inbox, destination);
      await rename(temporary, destination);
      return { path: relative(root, destination).replace(/\\/g, "/"), size };
    } finally {
      signal.removeEventListener("abort", abort);
      await reader.cancel().catch(() => undefined);
      await rm(temporary, { force: true });
    }
  });
}
