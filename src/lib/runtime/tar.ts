import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, rm, open } from "node:fs/promises";
import path from "node:path";
import type { Readable, Writable } from "node:stream";

// A small POSIX ustar writer and reader, enough for FITRON backups: regular files, paths up to 255 characters, files
// of any size. Plain tar on purpose: a .fitronbackup without a password is a gzipped tar that Windows' own `tar -xzf`
// (built into Windows 10 and 11) or 7-Zip opens, so a gym's data can be read even without FITRON.

const BLOCK = 512;
const enc = new TextEncoder();

function octal(n: number, width: number): string {
  return n.toString(8).padStart(width - 1, "0") + "\0";
}

/** Splits a path into ustar's name (≤100) and prefix (≤155) at a "/". */
function splitName(p: string): { name: string; prefix: string } {
  if (enc.encode(p).length <= 100) return { name: p, prefix: "" };
  for (let i = p.lastIndexOf("/"); i > 0; i = p.lastIndexOf("/", i - 1)) {
    const prefix = p.slice(0, i);
    const name = p.slice(i + 1);
    if (enc.encode(name).length <= 100 && enc.encode(prefix).length <= 155) return { name, prefix };
  }
  throw new Error(`Path too long for the backup: ${p}`);
}

export function tarHeader(p: string, size: number, mtime = new Date()): Buffer {
  const h = Buffer.alloc(BLOCK);
  const { name, prefix } = splitName(p);
  h.write(name, 0, 100, "utf8");
  h.write(octal(0o644, 8), 100, 8, "ascii");
  h.write(octal(0, 8), 108, 8, "ascii");
  h.write(octal(0, 8), 116, 8, "ascii");
  h.write(octal(size, 12), 124, 12, "ascii");
  h.write(octal(Math.floor(mtime.getTime() / 1000), 12), 136, 12, "ascii");
  h.write("        ", 148, 8, "ascii");
  h.write("0", 156, 1, "ascii");
  h.write("ustar\0", 257, 6, "ascii");
  h.write("00", 263, 2, "ascii");
  h.write(prefix, 345, 155, "utf8");
  let sum = 0;
  for (const b of h) sum += b;
  h.write(octal(sum, 7) + " ", 148, 8, "ascii");
  return h;
}

const pad = (size: number) => (BLOCK - (size % BLOCK)) % BLOCK;

async function write(out: Writable, chunk: Buffer | Uint8Array) {
  if (!out.write(chunk)) await new Promise<void>((r) => out.once("drain", () => r()));
}

/** Writes tar entries to a stream. Call add / addFile in order, then end(). */
export class TarWriter {
  constructor(private readonly out: Writable) {}

  async add(p: string, body: Uint8Array, mtime?: Date) {
    await write(this.out, tarHeader(p, body.length, mtime));
    await write(this.out, body);
    if (pad(body.length)) await write(this.out, Buffer.alloc(pad(body.length)));
  }

  /** Streams a file from disk, so large documents are never held in memory. */
  async addFile(p: string, file: string, size: number, mtime?: Date) {
    await write(this.out, tarHeader(p, size, mtime));
    let written = 0;
    for await (const chunk of createReadStream(file)) {
      written += (chunk as Buffer).length;
      await write(this.out, chunk as Buffer);
    }
    if (written !== size) throw new Error(`File changed while being backed up: ${p}`);
    if (pad(size)) await write(this.out, Buffer.alloc(pad(size)));
  }

  async end() {
    await write(this.out, Buffer.alloc(BLOCK * 2));
    await new Promise<void>((resolve, reject) => {
      this.out.once("error", reject);
      this.out.end(() => resolve());
    });
  }
}

export type TarEntry = { path: string; size: number };

function parseHeader(h: Buffer): TarEntry | null {
  if (h.every((b) => b === 0)) return null;
  const str = (o: number, l: number) => h.subarray(o, o + l).toString("utf8").replace(/\0[\s\S]*$/, "");
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 32 : h[i]!;
  if (parseInt(str(148, 8).trim(), 8) !== sum) throw new Error("damaged archive (header checksum)");
  const type = str(156, 1);
  const name = str(0, 100);
  const prefix = str(345, 155);
  const size = parseInt(str(124, 12).trim() || "0", 8);
  if (type !== "0" && type !== "") throw new Error(`unexpected entry type "${type}" for ${name}`);
  return { path: prefix ? `${prefix}/${name}` : name, size };
}

/** A path inside a backup that is safe to write under a folder: no absolute paths, no "..". */
export function safeEntryPath(p: string): boolean {
  return p.length > 0 && !p.startsWith("/") && !p.includes("\\") && !/^[A-Za-z]:/.test(p) && p.split("/").every((s) => s !== "" && s !== "." && s !== "..");
}

/**
 * Reads tar entries from a stream. For each entry `onEntry` returns where to write it (a file path) or null to skip
 * it; `onData` sees every chunk (for hashing). Entries whose path is unsafe are refused.
 */
export async function readTar(input: Readable, handlers: { target: (e: TarEntry) => string | null; onData?: (e: TarEntry, chunk: Buffer) => void; onDone?: (e: TarEntry) => void | Promise<void> }) {
  let buf: Buffer = Buffer.alloc(0);
  let entry: TarEntry | null = null;
  let left = 0;
  let skip = 0;
  let sink: Awaited<ReturnType<typeof open>> | null = null;
  let ended = false;
  const finishEntry = async () => {
    if (sink) await sink.close();
    sink = null;
    if (entry) await handlers.onDone?.(entry);
    entry = null;
  };
  for await (const chunk of input) {
    buf = buf.length ? Buffer.concat([buf, chunk as Buffer]) : (chunk as Buffer);
    for (;;) {
      if (ended) break;
      if (skip) {
        const n = Math.min(skip, buf.length);
        buf = buf.subarray(n);
        skip -= n;
        if (skip) break;
      }
      if (entry && left > 0) {
        if (!buf.length) break;
        const n = Math.min(left, buf.length);
        const part = buf.subarray(0, n);
        handlers.onData?.(entry, part);
        if (sink) await sink.write(part);
        buf = buf.subarray(n);
        left -= n;
        if (left) break;
        skip = pad(entry.size);
        await finishEntry();
        continue;
      }
      if (buf.length < BLOCK) break;
      const e = parseHeader(buf.subarray(0, BLOCK));
      buf = buf.subarray(BLOCK);
      if (!e) {
        ended = true;
        break;
      }
      if (!safeEntryPath(e.path)) throw new Error(`unsafe path in archive: ${e.path}`);
      entry = e;
      left = e.size;
      const to = handlers.target(e);
      if (to) {
        await mkdir(path.dirname(to), { recursive: true });
        sink = await open(to, "w", 0o600);
      }
      if (left === 0) await finishEntry();
    }
  }
  if (entry) throw new Error("damaged archive (ends in the middle of a file)");
  if (!ended) throw new Error("damaged archive (no end marker)");
}

export async function atomicMove(from: string, to: string) {
  await mkdir(path.dirname(to), { recursive: true });
  await rm(to, { force: true });
  await rename(from, to);
}

export const writeStreamTo = (file: string) => createWriteStream(file, { mode: 0o600 });
