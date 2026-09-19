import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { receiveProjectAttachment, INCOMING_FILE_LIMIT, INBOX_FILE_LIMIT } from "../src/incoming-files.ts";
const exec = promisify(execFile);
const attachment = { fileId: "opaque", fileName: "../../report.txt", kind: "document" as const, size: 5 };

test("incoming bytes stay in a unique ignored inbox without replacing project files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-inbox-"));
  try {
    await exec("git", ["init", "-q", dir]);
    const signal = new AbortController().signal;
    const receive = () => receiveProjectAttachment(dir, attachment, signal, async () => new Response("hello"));
    const first = await receive(), second = await receive();
    assert.notEqual(first.path, second.path);
    assert.ok(first.path.startsWith(".pi/telegram-inbox/"));
    assert.equal(await readFile(join(dir, first.path), "utf8"), "hello");
    assert.equal(first.size, 5);
    await exec("git", ["check-ignore", "-q", "--", first.path], { cwd: dir });
    await exec("git", ["add", "-f", "--", first.path], { cwd: dir });
    await assert.rejects(receive(), /Git-tracked/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("incoming size, quota, truncation and cancellation checks remove partial files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-inbox-limits-"));
  try {
    const receive = (size: number | undefined, download: () => Promise<Response>, signal = new AbortController().signal) => receiveProjectAttachment(dir, { ...attachment, size }, signal, download);
    let called = false;
    await assert.rejects(receive(INCOMING_FILE_LIMIT + 1, async () => { called = true; return new Response(); }), /20 MB/);
    assert.equal(called, false);
    await assert.rejects(receive(5, async () => new Response("shorter?")), /Incomplete/);
    await assert.rejects(receive(undefined, async () => new Response(new Uint8Array(INCOMING_FILE_LIMIT + 1))), /exceeds/);
    const controller = new AbortController();
    await assert.rejects(receive(undefined, async () => {
      controller.abort();
      return new Response("hello");
    }, controller.signal));
    const inbox = join(dir, ".pi", "telegram-inbox");
    assert.deepEqual(await readdir(inbox), [".gitignore"]);
    for (let i = 0; i < INBOX_FILE_LIMIT; i++) await writeFile(join(inbox, `file-${i}`), "");
    await assert.rejects(receive(5, async () => new Response("hello")), /inbox is full/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("symbolic inbox paths are rejected", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-inbox-link-"));
  const outside = await mkdtemp(join(tmpdir(), "pi-inbox-outside-"));
  try {
    await mkdir(join(dir, ".pi"));
    await symlink(outside, join(dir, ".pi", "telegram-inbox"), process.platform === "win32" ? "junction" : "dir");
    await assert.rejects(receiveProjectAttachment(dir, attachment, new AbortController().signal, async () => new Response("hello")), /symbolic/);
    assert.deepEqual(await readdir(outside), []);
  } finally { await rm(dir, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); }
});
