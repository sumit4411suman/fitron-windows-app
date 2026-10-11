import { randomBytes } from "node:crypto";
import { mkdir, open, readdir, readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { assertValidKey, FileMissingError, type FileStorage, type StoredFileInfo } from "./file-storage";

const TMP = ".fitron-tmp-";
const isMissing = (e: unknown) => (e as NodeJS.ErrnoException)?.code === "ENOENT" || (e as NodeJS.ErrnoException)?.code === "ENOTDIR";

/**
 * Files in a folder: the Local Edition's …\FITRON\documents, or a server's STORAGE_DIR.
 *
 * A write goes to a temporary file beside the target, is flushed to the disk (fsync), and is then renamed over the
 * target, which is atomic on NTFS and on Linux file systems. A power cut leaves either the old file or the new one,
 * never half of either; a leftover temporary file is ignored by `list` and replaced by the next write.
 */
export class DiskFileStorage implements FileStorage {
  readonly mode = "DISK" as const;
  readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(/*turbopackIgnore: true*/ root);
  }

  /** The file's path, refusing any key that would land outside the root. */
  pathOf(key: string): string {
    assertValidKey(key);
    const p = path.resolve(this.root, ...key.split("/"));
    if (!p.startsWith(this.root + path.sep)) throw new Error("Bad storage key");
    return p;
  }

  // The content type is not needed on disk: readers sniff the bytes or take it from the record.
  async put(key: string, body: Uint8Array, _contentType?: string): Promise<void> {
    void _contentType;
    const p = this.pathOf(key);
    await mkdir(path.dirname(p), { recursive: true });
    const tmp = `${path.dirname(p)}${path.sep}${TMP}${randomBytes(6).toString("hex")}`;
    const fh = await open(tmp, "w", 0o600);
    try {
      await fh.writeFile(body);
      await fh.sync();
    } finally {
      await fh.close();
    }
    try {
      await rename(tmp, p);
    } catch (e) {
      await rm(tmp, { force: true });
      throw e;
    }
    // The rename itself is durable once the folder is flushed. Windows cannot open a folder to flush it; NTFS journals
    // the rename instead.
    if (process.platform !== "win32") {
      const dir = await open(path.dirname(p), "r");
      try {
        await dir.sync();
      } finally {
        await dir.close();
      }
    }
  }

  async get(key: string): Promise<Uint8Array> {
    try {
      return await readFile(/*turbopackIgnore: true*/ this.pathOf(key));
    } catch (e) {
      if (isMissing(e)) throw new FileMissingError(key);
      throw e;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathOf(key), { force: true });
  }

  async stat(key: string): Promise<StoredFileInfo | null> {
    try {
      const s = await stat(this.pathOf(key));
      return s.isFile() ? { key, size: s.size, modifiedAt: s.mtime } : null;
    } catch (e) {
      if (isMissing(e)) return null;
      throw e;
    }
  }

  async list(prefix: string): Promise<StoredFileInfo[]> {
    const out: StoredFileInfo[] = [];
    const walk = async (dir: string, rel: string): Promise<void> => {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch (e) {
        if (isMissing(e)) return;
        throw e;
      }
      for (const ent of entries) {
        if (ent.name.startsWith(TMP)) continue;
        const key = rel ? `${rel}/${ent.name}` : ent.name;
        if (ent.isDirectory()) await walk(path.join(dir, ent.name), key);
        else if (ent.isFile() && key.startsWith(prefix)) {
          const s = await stat(path.join(dir, ent.name));
          out.push({ key, size: s.size, modifiedAt: s.mtime });
        }
      }
    };
    // Start from the deepest folder the prefix names, so listing one gym never walks the others.
    const base = prefix.includes("/") ? prefix.slice(0, prefix.lastIndexOf("/")) : "";
    if (base) assertValidKey(base);
    await walk(base ? path.join(this.root, ...base.split("/")) : this.root, base);
    return out.sort((a, b) => a.key.localeCompare(b.key));
  }
}
