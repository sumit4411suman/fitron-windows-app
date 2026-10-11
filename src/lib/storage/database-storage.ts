import { db } from "@/lib/db";
import { assertValidKey, FileMissingError, type FileStorage, type StoredFileInfo } from "./file-storage";

/**
 * Files kept in the database (StoredFile): a hosted FITRON with no disk and no bucket (Vercel before a bucket is
 * connected), so backups, photos and documents can still be saved until one is. Never the Local Edition, whose files
 * live in the data folder. A file is one row, replaced whole, so a crash mid-write leaves the old file or the new one.
 */
export class DatabaseFileStorage implements FileStorage {
  readonly mode = "DATABASE" as const;

  async put(key: string, body: Uint8Array, contentType: string): Promise<void> {
    assertValidKey(key);
    const data = { body: Buffer.from(body), contentType, size: body.byteLength };
    await db.storedFile.upsert({ where: { key }, create: { key, ...data }, update: data });
  }

  async get(key: string): Promise<Uint8Array> {
    assertValidKey(key);
    const f = await db.storedFile.findUnique({ where: { key }, select: { body: true } });
    if (!f) throw new FileMissingError(key);
    return new Uint8Array(f.body);
  }

  async delete(key: string): Promise<void> {
    assertValidKey(key);
    await db.storedFile.deleteMany({ where: { key } });
  }

  async stat(key: string): Promise<StoredFileInfo | null> {
    assertValidKey(key);
    const f = await db.storedFile.findUnique({ where: { key }, select: { size: true, createdAt: true } });
    return f ? { key, size: f.size, modifiedAt: f.createdAt } : null;
  }

  async list(prefix: string): Promise<StoredFileInfo[]> {
    const rows = await db.storedFile.findMany({ where: { key: { startsWith: prefix } }, select: { key: true, size: true, createdAt: true }, orderBy: { key: "asc" } });
    return rows.map((r) => ({ key: r.key, size: r.size, modifiedAt: r.createdAt }));
  }
}
