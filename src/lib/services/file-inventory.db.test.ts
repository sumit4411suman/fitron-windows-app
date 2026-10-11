import { mkdtempSync, rmSync, unlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { DiskFileStorage } from "@/lib/storage";
import { hasDb, makeGym, pick } from "@/test/db";
import { fileInventory } from "./file-inventory";
import { createMember } from "./members";

// Phase 9: the database knows every file a gym's records point to; the inventory finds missing and stray files.
describe.skipIf(!hasDb)("file inventory (database)", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "fitron-inv-"));
  const storage = new DiskFileStorage(root);
  let orgId: string;
  let memberId: string;
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  beforeAll(async () => {
    const gym = await makeGym();
    orgId = gym.org.id;
    const admin = pick(await gym.user("Super Admin"), gym.a.id);
    memberId = (await createMember(admin, { name: "Asha Verma", gender: "Female", phone: "9811122233", source: "Walk-in", tags: [] })).id;
    const docKey = `${orgId}/members/${memberId}/doc1.pdf`;
    const photoKey = `${orgId}/members/${memberId}/photo/p1.jpg`;
    const logoKey = `${orgId}/gym/logo-1.png`;
    await storage.put(docKey, Buffer.from("%PDF-1.7 id proof"), "application/pdf");
    await storage.put(photoKey, Buffer.from("jpeg"), "image/jpeg");
    await storage.put(logoKey, Buffer.from("png!"), "image/png");
    await storage.put(`${orgId}/members/${memberId}/stray.pdf`, Buffer.from("upload whose record never saved"), "application/pdf");
    await db.memberDocument.create({ data: { orgId, memberId, kind: "ID proof", title: "Aadhaar", fileName: "aadhaar.pdf", mime: "application/pdf", size: 17, storageKey: docKey, uploadedById: admin.id } });
    await db.member.update({ where: { id: memberId }, data: { photoKey } });
    await db.setting.upsert({ where: { orgId_key: { orgId, key: "gym" } }, create: { orgId, key: "gym", value: { name: "G", logoKey } }, update: { value: { name: "G", logoKey } } });
  });

  it("lists every file the records point to, with its kind, and finds the stray upload", async () => {
    const inv = await fileInventory(orgId, storage);
    expect(inv.referenced.map((f) => f.kind).sort()).toEqual(["gym-logo", "member-document", "member-photo"]);
    expect(inv.present).toBe(3);
    expect(inv.missing).toEqual([]);
    expect(inv.orphans).toEqual([`${orgId}/members/${memberId}/stray.pdf`]);
    expect(inv.bytes).toBe(17 + 4 + 4);
  });

  it("reports a file deleted outside FITRON as missing, and keeps the record", async () => {
    unlinkSync(storage.pathOf(`${orgId}/members/${memberId}/doc1.pdf`));
    const inv = await fileInventory(orgId, storage);
    expect(inv.missing.map((f) => f.kind)).toEqual(["member-document"]);
    expect(await db.memberDocument.count({ where: { orgId } })).toBe(1);
  });
});
