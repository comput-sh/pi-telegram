import { realpath, stat, open } from "node:fs/promises";
import { constants } from "node:fs";
import { getGlobalSettingsPath, getProjectSettingsPath } from "./config.ts";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";

export const TELEGRAM_DOCUMENT_LIMIT = 50 * 1024 * 1024;
export const TELEGRAM_DOCUMENT_CAPTION_LIMIT = 1_024;

export interface TelegramProjectFile {
  path: string;
  fileName: string;
  contentType: string;
  size: number;
  projectRoot?: string;
  device?: number;
  inode?: number;
}

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".csv": "text/csv",
  ".doc": "application/msword",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".gif": "image/gif",
  ".html": "text/html",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".json": "application/json",
  ".md": "text/markdown",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx":
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".txt": "text/plain",
  ".webp": "image/webp",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".xml": "application/xml",
  ".zip": "application/zip",
};

function fileSuffix(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot < 0 ? "" : fileName.slice(dot).toLowerCase();
}

function assertSafeRelativePath(relativePath: string): void {
  const segments = relativePath
    .split(/[\\/]+/)
    .map((part) => part.toLowerCase());
  const fileName = segments.at(-1) || "";
  const isEnvironmentFile = fileName === ".env" || fileName.startsWith(".env.");
  const isPrivateKey =
    /\.(?:key|pem|p12|pfx)$/i.test(fileName) ||
    /^(?:id_rsa|id_dsa|id_ecdsa|id_ed25519)(?:\.pub)?$/i.test(fileName);
  const isCredentialFile =
    fileName === "local.settings.json" ||
    fileName === "credentials.json" ||
    fileName.endsWith(".credentials.json") ||
    fileName === "pi-telegram.local.json" ||
    fileName === "pi-telegram.settings.json" ||
    /^pi-telegram\.local\.json\..*\.tmp$/.test(fileName) ||
    fileName === ".npmrc" ||
    fileName === ".netrc" ||
    fileName === "auth.json";

  if (
    segments.includes(".git") ||
    isEnvironmentFile ||
    isPrivateKey ||
    isCredentialFile
  ) {
    throw new Error(
      "Pi Telegram will not send credential or repository-internal files.",
    );
  }
}

export function validateDocumentCaption(caption?: string): string | undefined {
  const normalized = caption?.trim();
  if (!normalized) return undefined;
  if (normalized.length > TELEGRAM_DOCUMENT_CAPTION_LIMIT) {
    throw new Error(
      `Telegram document captions must not exceed ${TELEGRAM_DOCUMENT_CAPTION_LIMIT} characters.`,
    );
  }
  return normalized;
}

export async function resolveTelegramProjectFile(
  cwd: string,
  filePath: string,
): Promise<TelegramProjectFile> {
  if (!filePath.trim()) throw new Error("A file path is required.");

  const projectRoot = await realpath(cwd);
  const requestedPath = resolve(cwd, filePath);
  let canonicalPath: string;
  try {
    canonicalPath = await realpath(requestedPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`File not found: ${filePath}`);
    }
    throw error;
  }

  const projectRelativePath = relative(projectRoot, canonicalPath);
  if (
    !projectRelativePath ||
    projectRelativePath === ".." ||
    projectRelativePath.startsWith(`..${sep}`) ||
    isAbsolute(projectRelativePath)
  ) {
    throw new Error(
      "Telegram files must be located inside the active project.",
    );
  }
  assertSafeRelativePath(projectRelativePath);
  await assertNotConfiguredCredential(canonicalPath, cwd);

  const information = await stat(canonicalPath);
  if (!information.isFile())
    throw new Error("The Telegram attachment must be a file.");
  if (information.size > TELEGRAM_DOCUMENT_LIMIT) {
    throw new Error("Telegram documents must not exceed 50 MB.");
  }

  const fileName = basename(canonicalPath);
  return {
    path: canonicalPath,
    fileName,
    contentType:
      CONTENT_TYPES[fileSuffix(fileName)] || "application/octet-stream",
    size: information.size,
    projectRoot,
    device: information.dev,
    inode: information.ino,
  };
}

async function assertNotConfiguredCredential(
  path: string,
  cwd: string,
): Promise<void> {
  for (const configured of [
    getGlobalSettingsPath(),
    getProjectSettingsPath(cwd),
  ]) {
    const canonical = await realpath(configured).catch(() =>
      resolve(configured),
    );
    const normalize = (value: string) =>
      process.platform === "win32" ? value.toLowerCase() : value;
    const candidate = normalize(path);
    const secret = normalize(canonical);
    if (
      candidate === secret ||
      (candidate.startsWith(`${secret}.`) && candidate.endsWith(".tmp"))
    ) {
      throw new Error(
        "Pi Telegram will not send configured credentials or their temporary files.",
      );
    }
  }
}

export async function readTelegramProjectFile(
  file: TelegramProjectFile,
): Promise<Buffer> {
  if (!file.projectRoot)
    throw new Error(
      "Telegram attachment must be resolved inside its project before upload.",
    );
  const checked = await resolveTelegramProjectFile(file.projectRoot, file.path);
  if (
    checked.path !== file.path ||
    checked.inode !== file.inode ||
    checked.device !== file.device
  )
    throw new Error("Telegram attachment changed after validation.");
  const handle = await open(
    file.path,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  try {
    const info = await handle.stat();
    if (
      !info.isFile() ||
      info.ino !== file.inode ||
      info.dev !== file.device ||
      info.size > TELEGRAM_DOCUMENT_LIMIT
    )
      throw new Error("Telegram attachment changed after validation.");
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}
