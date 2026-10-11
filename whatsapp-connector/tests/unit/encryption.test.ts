import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decrypt, deriveKey, encrypt, isEncrypted, safeEqual, sha256Hex } from "../../src/utils/encryption.js";
import { generateApiKey, hashApiKey, looksLikeApiKey } from "../../src/utils/apiKey.js";
import { hasSavedCredentials, removeAuthFolder, useEncryptedFileAuthState } from "../../src/whatsapp/authState.js";

describe("encryption", () => {
  const key = deriveKey("a passphrase");
  it("round-trips and authenticates", () => {
    const blob = encrypt("hello", key);
    expect(isEncrypted(blob)).toBe(true);
    expect(decrypt(blob, key).toString()).toBe("hello");
    expect(() => decrypt(blob, deriveKey("other"))).toThrow();
    blob.writeUInt8(blob.readUInt8(blob.length - 1) ^ 0xff, blob.length - 1);
    expect(() => decrypt(blob, key)).toThrow();
  });
  it("hashes and compares in constant time", () => {
    expect(sha256Hex("x")).toHaveLength(64);
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "ab")).toBe(false);
  });
  it("generates api keys that only hash to the stored value", () => {
    const k = generateApiKey();
    expect(looksLikeApiKey(k.key)).toBe(true);
    expect(k.hash).toBe(hashApiKey(k.key));
    expect(k.prefix).toBe(k.key.slice(0, 10));
    expect(looksLikeApiKey("wak_short")).toBe(false);
  });
});

describe("encrypted auth state", () => {
  let dir: string;
  const key = deriveKey("session-key");
  beforeEach(async () => (dir = await mkdtemp(join(tmpdir(), "wa-auth-"))));
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it("writes nothing readable to disk and reads it back after a restart", async () => {
    const a = await useEncryptedFileAuthState(dir, key);
    expect(a.registered()).toBe(false);
    expect(await hasSavedCredentials(dir, key)).toBe(false);
    a.state.creds.registered = true;
    a.state.creds.me = { id: "919999900000:1@s.whatsapp.net" };
    await a.saveCreds();
    await a.state.keys.set({ "pre-key": { "1": { public: new Uint8Array([1, 2]), private: new Uint8Array([3, 4]) } }, session: { "919@s.whatsapp.net": new Uint8Array([9]) } });
    const raw = await readFile(join(dir, "creds.json"));
    expect(isEncrypted(raw)).toBe(true);
    expect(raw.toString()).not.toContain("registered");
    expect(await hasSavedCredentials(dir, key)).toBe(true);

    const b = await useEncryptedFileAuthState(dir, key);
    expect(b.registered()).toBe(true);
    expect(b.state.creds.me?.id).toBe("919999900000:1@s.whatsapp.net");
    const got = await b.state.keys.get("pre-key", ["1", "missing"]);
    expect(Buffer.from(got["1"]!.public)).toEqual(Buffer.from([1, 2]));
    expect(got.missing).toBeUndefined();
    await b.state.keys.set({ "pre-key": { "1": null } });
    expect(await b.state.keys.get("pre-key", ["1"])).toEqual({});
  });

  it("cannot be read with another key, and is gone after removal", async () => {
    const a = await useEncryptedFileAuthState(dir, key);
    a.state.creds.registered = true;
    a.state.creds.me = { id: "1@s.whatsapp.net" };
    await a.saveCreds();
    expect(await hasSavedCredentials(dir, deriveKey("wrong"))).toBe(false);
    await removeAuthFolder(dir);
    expect(await hasSavedCredentials(dir, key)).toBe(false);
  });
});
