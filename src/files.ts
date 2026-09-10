import { realpath, stat } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";

export const TELEGRAM_DOCUMENT_LIMIT = 50 * 1024 * 1024;
export const TELEGRAM_DOCUMENT_CAPTION_LIMIT = 1_024;

export interface TelegramProjectFile {
  path: string;
  fileName: string;
  contentType: string;
  size: number;
}

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".csv": "text/csv",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".gif": "image/gif",
  ".html": "text/html",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".json": "application/json",
  ".md": "text/markdown",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
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
  const segments = relativePath.split(/[\\/]+/).map((part) => part.toLowerCase());
  const fileName = segments.at(-1) || "";
  const isEnvironmentFile = fileName === ".env" || fileName.startsWith(".env.");
  const isPrivateKey =
    /\.(?:key|pem|p12|pfx)$/i.test(fileName) ||
    /^(?:id_rsa|id_dsa|id_ecdsa|id_ed25519)(?:\.pub)?$/i.test(fileName);
  const isCredentialFile =
    fileName === "local.settings.json" ||
    fileName === "servicehost.credentials.json" ||
    fileName === "pi-telegram.local.json" ||
    fileName === "pi-telegram.settings.json";

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
    throw new Error("Telegram files must be located inside the active project.");
  }
  assertSafeRelativePath(projectRelativePath);

  const information = await stat(canonicalPath);
  if (!information.isFile()) throw new Error("The Telegram attachment must be a file.");
  if (information.size > TELEGRAM_DOCUMENT_LIMIT) {
    throw new Error("Telegram documents must not exceed 50 MB.");
  }

  const fileName = basename(canonicalPath);
  return {
    path: canonicalPath,
    fileName,
    contentType: CONTENT_TYPES[fileSuffix(fileName)] || "application/octet-stream",
    size: information.size,
  };
}
