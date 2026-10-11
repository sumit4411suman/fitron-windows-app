import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { hasDb } from "@/test/db";
import { isLocal } from "@/lib/runtime/edition";
import { deleteObject, getObject, putObject, storageMode } from "./storage";

const KEYS = ["S3_ENDPOINT", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "VERCEL"];
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));

// The Local Edition's files always go to the data folder, so this is the Cloud Edition's test.
describe.skipIf(!hasDb || isLocal())("file storage in the database (database)", () => {
  beforeAll(() => {
    for (const k of KEYS) delete process.env[k];
    process.env.VERCEL = "1";
  });
  afterAll(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k]!;
    }
  });

  it("saves, reads back, replaces and deletes a file on a host with no disk and no bucket", async () => {
    expect(storageMode()).toBe("DATABASE");
    const key = `test/${randomUUID()}/backup.json`;
    await putObject(key, new TextEncoder().encode('{"a":1}'), "application/json");
    expect(new TextDecoder().decode(await getObject(key))).toBe('{"a":1}');
    await putObject(key, new TextEncoder().encode('{"a":2}'), "application/json");
    expect(new TextDecoder().decode(await getObject(key))).toBe('{"a":2}');
    await deleteObject(key);
    await expect(getObject(key)).rejects.toThrow(/not found/);
    await deleteObject(key);
  });
});
