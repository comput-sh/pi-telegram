import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateTelegramPhoto, TELEGRAM_PHOTO_LIMIT } from "../src/photos.ts";
import { resolveTelegramProjectFile } from "../src/files.ts";
import { TelegramSessionConnection } from "../src/telegram.ts";

const image = (width = 32, height = 16) => sharp({ create: { width, height, channels: 3, background: "blue" } });

test("photos validate actual PNG/JPEG bytes, not extensions", async () => {
  assert.equal(await validateTelegramPhoto(await image().png().toBuffer()), "image/png");
  assert.equal(await validateTelegramPhoto(await image().jpeg().toBuffer()), "image/jpeg");
  for (const bytes of [Buffer.from("fake png"), await image().webp().toBuffer(), (await image().png().toBuffer()).subarray(0, 40)])
    await assert.rejects(validateTelegramPhoto(bytes), /valid PNG or JPEG/);
});

test("photos enforce size, sum of dimensions, and aspect ratio", async () => {
  await assert.rejects(validateTelegramPhoto(Buffer.alloc(TELEGRAM_PHOTO_LIMIT + 1)), /10 MB/);
  await assert.rejects(validateTelegramPhoto(await image(21, 1).png().toBuffer()), /aspect ratio/);
  await assert.rejects(validateTelegramPhoto(await image(6000, 4001).png().toBuffer()), /10000/);
  assert.equal(await validateTelegramPhoto(await image(20, 1).png().toBuffer()), "image/png");
});

test("photo uploads use native sendPhoto, preserve bytes, reject invalid input and sanitize failures", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-photo-"));
  const original = globalThis.fetch;
  const bytes = await image().png().toBuffer();
  const path = join(dir, "photo.png");
  await writeFile(path, bytes);
  const file = await resolveTelegramProjectFile(dir, path);
  const connection = new TelegramSessionConnection("test-token", 42);
  let calls = 0;
  globalThis.fetch = (async (url, init) => {
    calls++;
    assert.ok(String(url).endsWith("/sendPhoto"));
    const form = init?.body as FormData;
    assert.equal(form.get("chat_id"), "42");
    assert.equal(form.get("caption"), "Preview");
    assert.equal(form.get("document"), null);
    const photo = form.get("photo") as File;
    assert.equal(photo.type, "image/png");
    assert.deepEqual(Buffer.from(await photo.arrayBuffer()), bytes);
    return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }));
  }) as typeof fetch;
  try {
    await connection.sendPhoto(file, " Preview ");
    assert.equal(calls, 1);
    await assert.rejects(connection.sendPhoto(file, "x".repeat(1025)), /1024/);
    await assert.rejects(connection.sendPhoto(file, undefined, AbortSignal.abort()));
    assert.equal(calls, 1);
    globalThis.fetch = (async () => { throw new Error("https://api.telegram.org/bottest-token/sendPhoto"); }) as typeof fetch;
    await assert.rejects(connection.sendPhoto(file), (e: Error) => !e.message.includes("test-token") && /unconfirmed/.test(e.message));
    globalThis.fetch = (async () => new Response(JSON.stringify({ ok: false, error_code: 400, description: "Bad Request" }))) as typeof fetch;
    await assert.rejects(connection.sendPhoto(file));
    for (const disconnect of [false, true]) {
      const active = new TelegramSessionConnection("test-token", 42);
      const controller = new AbortController();
      let started!: () => void;
      const ready = new Promise<void>((resolve) => { started = resolve; });
      globalThis.fetch = (async (_url, init) => new Promise<Response>((_resolve, reject) => {
        const signal = init!.signal!;
        signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        started();
      })) as typeof fetch;
      const upload = active.sendPhoto(file, undefined, controller.signal);
      const rejected = assert.rejects(upload, /cancelled or timed out/);
      await ready;
      if (disconnect) await active.stop();
      else controller.abort();
      await rejected;
    }
    await writeFile(path, "not a photo");
    await assert.rejects(connection.sendPhoto(await resolveTelegramProjectFile(dir, path)), /valid PNG or JPEG/);
  } finally {
    globalThis.fetch = original;
    await rm(dir, { recursive: true, force: true });
  }
});
