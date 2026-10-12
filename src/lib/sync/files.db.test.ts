import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { hasDb, makeGym, pick } from "@/test/db";
import { isLocal } from "@/lib/runtime/edition";
import { createMember } from "@/lib/services/members";
import { getObjectOrNull, putObject } from "@/lib/integrations/storage";
import { readRecord } from "./records";
import { authDevice, linkDevice, pushOne } from "./server";
import { FILE_PART, missingFiles, readFilePart, removeUnusedFiles, storeFilePart } from "./files";

// Files of a linked gym on fitron.in (src/lib/sync/files.ts): only files a record of the same gym points to move, in
// pieces, whole and of an accepted type; a file whose last record went away through an upload goes too.

const PASSWORD = "Files-test-password-1";
const pdf = (size: number) => {
  const b = Buffer.alloc(size, 7);
  b.write("%PDF-1.7\n", 0);
  return new Uint8Array(b);
};

async function gymWithDocument(size = 1000) {
  const gym = await makeGym();
  const owner = pick(await gym.user("Super Admin"), gym.a.id);
  await db.user.update({ where: { id: owner.id }, data: { passwordHash: await hashPassword(PASSWORD) } });
  const linked = await linkDevice({ email: owner.email, password: PASSWORD }, { name: "Front desk PC" });
  const dev = (await authDevice(`Bearer ${linked.token}`))!;
  const m = await createMember(owner, { name: "Has Papers", gender: "Female", phone: `98130${String(Math.floor(Math.random() * 1e5)).padStart(5, "0")}`, source: "Walk-in", tags: [] });
  const key = `${gym.org.id}/members/${m.id}/${randomUUID()}.pdf`;
  const doc = await db.memberDocument.create({ data: { orgId: gym.org.id, memberId: m.id, kind: "ID proof", title: "Aadhaar", fileName: "aadhaar.pdf", mime: "application/pdf", size, storageKey: key, uploadedById: owner.id } });
  return { gym, owner, dev, m, key, doc };
}

describe.skipIf(!hasDb || isLocal())("cloud sync of files on fitron.in (database)", () => {
  beforeAll(() => {
    vi.stubEnv("STORAGE_DIR", mkdtempSync(path.join(tmpdir(), "fitron-sync-files-")));
  });

  it("lists a file its records point to and it lacks, takes it from the computer, then serves it back", async () => {
    const { gym, key } = await gymWithDocument();
    expect(await missingFiles(gym.org.id)).toContain(key);
    expect(await readFilePart(gym.org.id, key, 0)).toBeNull();
    const body = pdf(1000);
    expect(await storeFilePart(gym.org.id, key, { part: 0, parts: 1, size: body.length }, body)).toBe("stored");
    expect(await missingFiles(gym.org.id)).not.toContain(key);
    expect(Buffer.from((await readFilePart(gym.org.id, key, 0))!.body).equals(Buffer.from(body))).toBe(true);
    // Sent again (an answer that never arrived): already here.
    expect(await storeFilePart(gym.org.id, key, { part: 0, parts: 1, size: body.length }, body)).toBe("had");
  });

  it("puts a large file together from its pieces, and only when every piece has arrived", async () => {
    const { gym, key } = await gymWithDocument();
    const body = pdf(2 * FILE_PART + 12345);
    const piece = (i: number) => body.subarray(i * FILE_PART, (i + 1) * FILE_PART);
    const o = (part: number) => ({ part, parts: 3, size: body.length });
    expect(await storeFilePart(gym.org.id, key, o(2), piece(2))).toBe("part");
    expect(await storeFilePart(gym.org.id, key, o(0), piece(0))).toBe("part");
    expect(await getObjectOrNull(key)).toBeNull();
    expect(await storeFilePart(gym.org.id, key, o(1), piece(1))).toBe("stored");
    expect(Buffer.from((await getObjectOrNull(key))!).equals(Buffer.from(body))).toBe(true);
    // Served back in the same pieces.
    const first = (await readFilePart(gym.org.id, key, 0))!;
    expect(first).toMatchObject({ size: body.length, parts: 3 });
    const back = Buffer.concat([first.body, (await readFilePart(gym.org.id, key, 1))!.body, (await readFilePart(gym.org.id, key, 2))!.body]);
    expect(back.equals(Buffer.from(body))).toBe(true);
    // The pieces themselves are gone.
    expect((await missingFiles(gym.org.id)).some((k) => k.includes("sync-parts"))).toBe(false);
  });

  it("refuses a file no record points to, another gym's file, a backup, a piece of the wrong size and a type uploads do not take", async () => {
    const a = await gymWithDocument();
    const b = await gymWithDocument();
    const body = pdf(500);
    const one = { part: 0, parts: 1, size: body.length };
    await expect(storeFilePart(a.gym.org.id, `${a.gym.org.id}/members/${a.m.id}/${randomUUID()}.pdf`, one, body)).rejects.toThrow(/No record of this gym/);
    await expect(storeFilePart(a.gym.org.id, b.key, one, body)).rejects.toThrow(/No record of this gym/);
    await expect(storeFilePart(a.gym.org.id, `${a.gym.org.id}/backups/x.json`, one, body)).rejects.toThrow(/No record of this gym/);
    await expect(storeFilePart(a.gym.org.id, a.key, { part: 0, parts: 1, size: 600 }, body)).rejects.toThrow(/not the size/);
    await expect(storeFilePart(a.gym.org.id, a.key, { part: 0, parts: 1, size: 20 * 1024 * 1024 }, body)).rejects.toThrow(/too large/);
    const html = new TextEncoder().encode("<html><script>alert(1)</script></html>");
    await expect(storeFilePart(a.gym.org.id, a.key, { part: 0, parts: 1, size: html.length }, html)).rejects.toThrow(/Only PDF/);
    expect(await getObjectOrNull(a.key)).toBeNull();
    // Another gym's file is never served.
    await putObject(b.key, body, "application/pdf");
    expect(await readFilePart(a.gym.org.id, b.key, 0)).toBeNull();
  });

  it("a document deleted on the computer (an erasure) takes its file with it here; a file another record still uses stays", async () => {
    const { gym, dev, m, key, doc } = await gymWithDocument();
    await putObject(key, pdf(1000), "application/pdf");
    const r = await pushOne(dev, { changeId: randomUUID().replace(/-/g, ""), entity: "MemberDocument", entityId: doc.id, op: "delete", data: null, baseVersion: 0 });
    expect(r).toMatchObject({ status: "applied" });
    expect(await db.memberDocument.findUnique({ where: { id: doc.id } })).toBeNull();
    expect(await getObjectOrNull(key)).toBeNull();

    // The member's photo is also a document of theirs: dropping the photo leaves the document's file.
    const shared = `${gym.org.id}/members/${m.id}/${randomUUID()}.jpg`;
    const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
    await putObject(shared, jpg, "image/jpeg");
    const owner = (await db.user.findFirstOrThrow({ where: { orgId: gym.org.id } })).id;
    await db.memberDocument.create({ data: { orgId: gym.org.id, memberId: m.id, kind: "Photo", title: "Photo", fileName: "p.jpg", mime: "image/jpeg", size: jpg.length, storageKey: shared, uploadedById: owner } });
    await db.member.update({ where: { id: m.id }, data: { photoKey: shared } });
    const member = (await readRecord(db, "Member", m.id))!;
    const r2 = await pushOne(dev, { changeId: randomUUID().replace(/-/g, ""), entity: "Member", entityId: m.id, op: "upsert", data: { ...member, photoKey: null }, baseVersion: Number((await db.syncChange.aggregate({ where: { entity: "Member", entityId: m.id }, _max: { seq: true } }))._max.seq) });
    expect(r2).toMatchObject({ status: "applied" });
    expect(await getObjectOrNull(shared)).not.toBeNull();
    // And nothing outside the gym's own files is ever removed.
    expect(await removeUnusedFiles(gym.org.id, ["../etc/passwd", `${gym.org.id}/backups/b.json`, "other-gym/x.pdf"])).toBe(0);
  });
});
