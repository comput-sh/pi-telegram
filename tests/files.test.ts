import assert from "node:assert/strict";
import { mkdtemp, mkdir, open, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  TELEGRAM_DOCUMENT_LIMIT,
  resolveTelegramProjectFile,
  validateDocumentCaption,
} from "../src/files.ts";

test("resolveTelegramProjectFile accepts ordinary files inside the project", async () => {
  const project = await mkdtemp(join(tmpdir(), "pi-telegram-extension-files-"));
  try {
    await mkdir(join(project, "artifacts"));
    await writeFile(join(project, "artifacts", "report.txt"), "hello", "utf8");

    const file = await resolveTelegramProjectFile(
      project,
      join("artifacts", "report.txt"),
    );
    assert.equal(file.fileName, "report.txt");
    assert.equal(file.contentType, "text/plain");
    assert.equal(file.size, 5);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("resolveTelegramProjectFile rejects paths outside the active project", async () => {
  const parent = await mkdtemp(join(tmpdir(), "pi-telegram-extension-files-"));
  const project = join(parent, "project");
  try {
    await mkdir(project);
    await writeFile(join(parent, "outside.txt"), "private", "utf8");
    await assert.rejects(
      () => resolveTelegramProjectFile(project, join("..", "outside.txt")),
      /inside the active project/,
    );
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("resolveTelegramProjectFile blocks credential-like files", async () => {
  const project = await mkdtemp(join(tmpdir(), "pi-telegram-extension-files-"));
  try {
    for (const fileName of [
      "local.settings.json",
      "pi-telegram-extension.local.json",
      ".env.production",
      "client.pem",
    ]) {
      await writeFile(join(project, fileName), "secret", "utf8");
      await assert.rejects(
        () => resolveTelegramProjectFile(project, fileName),
        /will not send credential/,
      );
    }
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("resolveTelegramProjectFile rejects documents larger than Telegram's limit", async () => {
  const project = await mkdtemp(join(tmpdir(), "pi-telegram-extension-files-"));
  try {
    const path = join(project, "large.bin");
    const handle = await open(path, "w");
    try {
      await handle.truncate(TELEGRAM_DOCUMENT_LIMIT + 1);
    } finally {
      await handle.close();
    }
    await assert.rejects(
      () => resolveTelegramProjectFile(project, path),
      /must not exceed 50 MB/,
    );
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

test("validateDocumentCaption trims captions and enforces Telegram's limit", () => {
  assert.equal(validateDocumentCaption(" report ready "), "report ready");
  assert.equal(validateDocumentCaption("  "), undefined);
  assert.throws(
    () => validateDocumentCaption("x".repeat(1_025)),
    /must not exceed 1024/,
  );
});
