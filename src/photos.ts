import sharp from "sharp";

export const TELEGRAM_PHOTO_LIMIT = 10 * 1024 * 1024;

/** Validate the exact upload bytes; never convert or strip metadata. */
export async function validateTelegramPhoto(bytes: Buffer): Promise<string> {
  if (bytes.length > TELEGRAM_PHOTO_LIMIT)
    throw new Error("Telegram photos must not exceed 10 MB. Request document delivery for the original.");
  try {
    const image = sharp(bytes, { failOn: "warning", limitInputPixels: 25_000_000 });
    const metadata = await image.metadata();
    if (metadata.format !== "png" && metadata.format !== "jpeg")
      throw new Error("format");
    const { width, height } = metadata;
    if (!width || !height || width + height > 10_000 || Math.max(width / height, height / width) > 20)
      throw new Error("dimensions");
    // Force decoding, not merely header inspection, to reject corrupt/truncated data.
    await image.stats();
    return metadata.format === "png" ? "image/png" : "image/jpeg";
  } catch {
    throw new Error("Photo must be a valid PNG or JPEG with width + height at most 10000 and aspect ratio at most 20:1. No conversion or document fallback was performed.");
  }
}
