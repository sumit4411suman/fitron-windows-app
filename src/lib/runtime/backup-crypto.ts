import { createCipheriv, createDecipheriv, randomBytes, scrypt as scryptCb } from "node:crypto";
import { open } from "node:fs/promises";
import type { Transform } from "node:stream";
import { promisify } from "node:util";

// Optional password on a .fitronbackup. The gzipped archive is encrypted with AES-256-GCM under a key derived from the
// password with scrypt (N=2^15, r=8, p=1), with a fresh salt and nonce per file. GCM's tag at the end proves the file
// is whole and the password right: a wrong password and a damaged file are both refused before anything is restored.
//
//   "FITRONENC1\n" (11 bytes) | salt (16) | nonce (12) | ciphertext | tag (16)
//
// Without a password the file is the gzipped archive itself (starts with 1f 8b).

export const ENC_MAGIC = Buffer.from("FITRONENC1\n", "ascii");
const SALT = 16;
const NONCE = 12;
const TAG = 16;
const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;

const deriveKey = (password: string, salt: Buffer) => scrypt(password.normalize("NFKC"), salt, 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });

export async function encryptionHeader(password: string) {
  const salt = randomBytes(SALT);
  const nonce = randomBytes(NONCE);
  const cipher = createCipheriv("aes-256-gcm", await deriveKey(password, salt), nonce);
  cipher.setAAD(ENC_MAGIC);
  return { header: Buffer.concat([ENC_MAGIC, salt, nonce]), cipher };
}

export type BackupFileKind = "gzip" | "encrypted" | "unknown";

export async function fileKind(file: string): Promise<BackupFileKind> {
  const fh = await open(file, "r");
  try {
    const b = Buffer.alloc(ENC_MAGIC.length);
    const { bytesRead } = await fh.read(b, 0, b.length, 0);
    if (bytesRead >= 2 && b[0] === 0x1f && b[1] === 0x8b) return "gzip";
    if (bytesRead === ENC_MAGIC.length && b.equals(ENC_MAGIC)) return "encrypted";
    return "unknown";
  } finally {
    await fh.close();
  }
}

/** The decipher for an encrypted backup, and where its ciphertext starts and ends in the file. */
export async function openEncrypted(file: string, password: string): Promise<{ decipher: Transform; start: number; end: number }> {
  const fh = await open(file, "r");
  try {
    const { size } = await fh.stat();
    if (size < ENC_MAGIC.length + SALT + NONCE + TAG) throw new Error("too short");
    const head = Buffer.alloc(ENC_MAGIC.length + SALT + NONCE);
    await fh.read(head, 0, head.length, 0);
    const tag = Buffer.alloc(TAG);
    await fh.read(tag, 0, TAG, size - TAG);
    const salt = head.subarray(ENC_MAGIC.length, ENC_MAGIC.length + SALT);
    const nonce = head.subarray(ENC_MAGIC.length + SALT);
    const decipher = createDecipheriv("aes-256-gcm", await deriveKey(password, salt), nonce);
    decipher.setAAD(ENC_MAGIC);
    decipher.setAuthTag(tag);
    return { decipher, start: head.length, end: size - TAG - 1 };
  } finally {
    await fh.close();
  }
}
