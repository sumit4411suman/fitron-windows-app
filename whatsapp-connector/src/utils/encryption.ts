import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";

// AES-256-GCM for data at rest (WhatsApp authentication files). The key is derived from SESSION_ENCRYPTION_KEY with
// SHA-256 so any sufficiently long passphrase works. Format: magic(4) | iv(12) | tag(16) | ciphertext.

const MAGIC = Buffer.from("WAC1");

export function deriveKey(secret: string): Buffer {
  return createHash("sha256").update(secret, "utf8").digest();
}

export function encrypt(plain: Buffer | string, key: Buffer): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.isBuffer(plain) ? plain : Buffer.from(plain, "utf8");
  const enc = Buffer.concat([cipher.update(data), cipher.final()]);
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), enc]);
}

export function decrypt(blob: Buffer, key: Buffer): Buffer {
  if (blob.length < 4 + 12 + 16 || !blob.subarray(0, 4).equals(MAGIC)) throw new Error("Not an encrypted blob");
  const iv = blob.subarray(4, 16);
  const tag = blob.subarray(16, 32);
  const data = blob.subarray(32);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}

export const isEncrypted = (blob: Buffer): boolean => blob.length >= 4 && blob.subarray(0, 4).equals(MAGIC);

export function sha256Hex(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

/** Constant-time comparison of two strings (API keys). */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
