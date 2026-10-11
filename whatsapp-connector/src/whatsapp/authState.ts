import { mkdir, readdir, readFile, rm, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { BufferJSON, initAuthCreds, proto, type AuthenticationCreds, type AuthenticationState, type SignalDataSet, type SignalDataTypeMap } from "baileys";
import { decrypt, encrypt, isEncrypted } from "../utils/encryption.js";

// Baileys' supported persistence mechanism is the AuthenticationState interface; this implements it on top of one folder
// per gym, with every file encrypted at rest (AES-256-GCM). It mirrors the library's useMultiFileAuthState so a session
// survives restarts without a new QR scan, but nothing readable is left on disk.

const safeName = (file: string) => file.replace(/\//g, "__").replace(/:/g, "-");

export type EncryptedAuthState = { state: AuthenticationState; saveCreds: () => Promise<void>; registered: () => boolean };

export async function useEncryptedFileAuthState(folder: string, key: Buffer): Promise<EncryptedAuthState> {
  const info = await stat(folder).catch(() => null);
  if (info && !info.isDirectory()) throw new Error(`${folder} exists and is not a directory`);
  if (!info) await mkdir(folder, { recursive: true, mode: 0o700 });

  // Writes to one file are serialised: Baileys calls set() from several places at once.
  const locks = new Map<string, Promise<void>>();
  const withLock = async <T>(file: string, fn: () => Promise<T>): Promise<T> => {
    const prev = locks.get(file) ?? Promise.resolve();
    let release!: () => void;
    const mine = new Promise<void>((r) => (release = r));
    locks.set(file, prev.then(() => mine));
    await prev;
    try {
      return await fn();
    } finally {
      release();
      if (locks.get(file) === mine) locks.delete(file);
    }
  };

  const write = (data: unknown, file: string) => withLock(file, () => writeFile(join(folder, safeName(file)), encrypt(JSON.stringify(data, BufferJSON.replacer), key), { mode: 0o600 }));
  const read = <T>(file: string): Promise<T | null> =>
    withLock(file, async () => {
      try {
        const blob = await readFile(join(folder, safeName(file)));
        const text = isEncrypted(blob) ? decrypt(blob, key).toString("utf8") : blob.toString("utf8");
        return JSON.parse(text, BufferJSON.reviver) as T;
      } catch {
        return null;
      }
    });
  const remove = (file: string) => withLock(file, () => unlink(join(folder, safeName(file))).catch(() => undefined));

  const creds: AuthenticationCreds = (await read<AuthenticationCreds>("creds.json")) ?? initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async <T extends keyof SignalDataTypeMap>(type: T, ids: string[]) => {
          const data: { [id: string]: SignalDataTypeMap[T] } = {};
          await Promise.all(
            ids.map(async (id) => {
              let value = await read<SignalDataTypeMap[T]>(`${type}-${id}.json`);
              if (type === "app-state-sync-key" && value) value = proto.Message.AppStateSyncKeyData.fromObject(value as object) as unknown as SignalDataTypeMap[T];
              if (value) data[id] = value;
            }),
          );
          return data;
        },
        set: async (data: SignalDataSet) => {
          const tasks: Promise<unknown>[] = [];
          for (const category of Object.keys(data) as (keyof SignalDataSet)[]) {
            const entries = data[category];
            if (!entries) continue;
            for (const id of Object.keys(entries)) {
              const value = entries[id];
              const file = `${category}-${id}.json`;
              tasks.push(value ? write(value, file) : remove(file));
            }
          }
          await Promise.all(tasks);
        },
      },
    },
    saveCreds: () => write(creds, "creds.json"),
    registered: () => !!creds.registered,
  };
}

/** Is there a saved, registered login in this folder? Decides whether a restart can reconnect without a QR. */
export async function hasSavedCredentials(folder: string, key: Buffer): Promise<boolean> {
  try {
    const blob = await readFile(join(folder, "creds.json"));
    const text = isEncrypted(blob) ? decrypt(blob, key).toString("utf8") : blob.toString("utf8");
    const creds = JSON.parse(text, BufferJSON.reviver) as Partial<AuthenticationCreds>;
    return !!creds.registered && !!creds.me?.id;
  } catch {
    return false;
  }
}

/** Removes every saved file for the session. Used on logout and when WhatsApp reports the login is gone. */
export async function removeAuthFolder(folder: string): Promise<void> {
  await rm(folder, { recursive: true, force: true });
}

export async function listSessionFolders(root: string): Promise<string[]> {
  try {
    return (await readdir(root, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return [];
  }
}
