import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { AppError } from "../utils/errors.js";
import type { MessageType } from "../generated/prisma/index.js";

// Files a gym may send: receipts, invoices, plan PDFs, pictures. Executables and anything not on this list are refused,
// and the content is checked against the declared type (magic bytes) so a renamed .exe does not pass as a PDF.

export type AllowedMime = keyof typeof ALLOWED;
export const ALLOWED = {
  "application/pdf": { ext: [".pdf"], type: "PDF" as MessageType, magic: [Buffer.from("%PDF")] },
  "image/jpeg": { ext: [".jpg", ".jpeg"], type: "IMAGE" as MessageType, magic: [Buffer.from([0xff, 0xd8, 0xff])] },
  "image/png": { ext: [".png"], type: "IMAGE" as MessageType, magic: [Buffer.from([0x89, 0x50, 0x4e, 0x47])] },
  "image/webp": { ext: [".webp"], type: "IMAGE" as MessageType, magic: [Buffer.from("RIFF")] },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": { ext: [".docx"], type: "DOCUMENT" as MessageType, magic: [Buffer.from([0x50, 0x4b, 0x03, 0x04])] },
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": { ext: [".xlsx"], type: "DOCUMENT" as MessageType, magic: [Buffer.from([0x50, 0x4b, 0x03, 0x04])] },
  "text/csv": { ext: [".csv"], type: "DOCUMENT" as MessageType, magic: [] },
} as const;

export type StoredMedia = { path: string; mimeType: AllowedMime; messageType: MessageType; fileName: string; size: number };

const safeFileName = (name: string) =>
  name
    .replace(/[\\/]/g, "_")
    .replace(/[^\w.\- ()]/g, "_")
    .slice(0, 120) || "file";

export class MediaService {
  constructor(
    private readonly root: string,
    private readonly maxBytes: number,
  ) {}

  /** Checks type, extension, size and magic bytes. Throws UNSUPPORTED_MEDIA_TYPE or FILE_TOO_LARGE. */
  validate(file: { buffer: Buffer; mimeType: string; fileName: string }): { mimeType: AllowedMime; messageType: MessageType; fileName: string } {
    const mime = file.mimeType.toLowerCase().split(";")[0]?.trim() ?? "";
    const spec = (ALLOWED as Record<string, (typeof ALLOWED)[AllowedMime]>)[mime];
    if (!spec) throw new AppError("UNSUPPORTED_MEDIA_TYPE", `Files of type "${file.mimeType || "unknown"}" cannot be sent. Allowed: ${Object.keys(ALLOWED).join(", ")}.`);
    if (file.buffer.length === 0) throw new AppError("VALIDATION_ERROR", "The file is empty.");
    if (file.buffer.length > this.maxBytes) throw new AppError("FILE_TOO_LARGE", `The file is larger than ${Math.round(this.maxBytes / 1024 / 1024)} MB.`);
    const name = safeFileName(file.fileName);
    const ext = name.includes(".") ? name.slice(name.lastIndexOf(".")).toLowerCase() : "";
    if (ext && !(spec.ext as readonly string[]).includes(ext)) throw new AppError("UNSUPPORTED_MEDIA_TYPE", `The file extension "${ext}" does not match its type ${mime}.`);
    if (spec.magic.length && !spec.magic.some((m) => file.buffer.subarray(0, m.length).equals(m))) throw new AppError("UNSUPPORTED_MEDIA_TYPE", `The file content does not look like ${mime}.`);
    return { mimeType: mime as AllowedMime, messageType: spec.type, fileName: ext ? name : name + (spec.ext[0] ?? "") };
  }

  async store(gymId: string, messageId: string, file: { buffer: Buffer; mimeType: string; fileName: string }): Promise<StoredMedia> {
    const v = this.validate(file);
    const dir = join(this.root, gymId);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const path = join(dir, `${messageId}.bin`);
    await writeFile(path, file.buffer, { mode: 0o600 });
    return { path, mimeType: v.mimeType, messageType: v.messageType, fileName: v.fileName, size: file.buffer.length };
  }

  /** Reads a stored file, refusing paths outside the gym's folder. */
  async read(gymId: string, path: string): Promise<Buffer> {
    const dir = join(this.root, gymId);
    if (!path.startsWith(dir + "/") && !path.startsWith(dir + "\\")) throw new AppError("FORBIDDEN", "Media path does not belong to this gym.");
    return readFile(path);
  }

  async remove(path: string | null | undefined): Promise<void> {
    if (path) await rm(path, { force: true }).catch(() => undefined);
  }
}
