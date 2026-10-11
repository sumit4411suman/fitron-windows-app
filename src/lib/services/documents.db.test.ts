import { beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { db } from "@/lib/db";
import { hasDb, makeGym, pick } from "@/test/db";
import { createMember } from "./members";
import * as storage from "@/lib/integrations/storage";
import { UserError } from "./errors";
import { deleteDocument, listDocuments, purgeDocuments, readDocument, replaceDocument, uploadDocument } from "./documents";

vi.mock("@/lib/integrations/storage", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/integrations/storage")>();
  return { ...real, putObject: vi.fn(real.putObject) };
});
const { getObject } = storage;

const pdf = (text: string) => new File([`%PDF-1.4\n${text}`], "scan.pdf", { type: "application/pdf" });

describe.skipIf(!hasDb)("Member documents (database)", () => {
  let gym: Awaited<ReturnType<typeof makeGym>>;
  let desk: Awaited<ReturnType<Awaited<ReturnType<typeof makeGym>>["user"]>>;
  let memberId: string;

  beforeAll(async () => {
    vi.stubEnv("STORAGE_DIR", mkdtempSync(path.join(tmpdir(), "fitron-docs-")));
    vi.stubEnv("S3_BUCKET", "");
    gym = await makeGym();
    desk = pick(await gym.user("Receptionist"), gym.a.id);
    memberId = (await createMember(desk, { name: "Doc Devi", gender: "Female", phone: "9877700001", source: "Walk-in", tags: [] })).id;
  });

  it("upload, replace and delete keep the full history", async () => {
    await expect(uploadDocument(desk, memberId, { kind: "ID proof", title: "Aadhaar" }, new File(["<script>"], "x.pdf"))).rejects.toThrow(/PDF, JPG/);
    const first = await uploadDocument(desk, memberId, { kind: "ID proof", title: "Aadhaar" }, pdf("v1"));
    const second = await replaceDocument(desk, first.id, pdf("v2"));
    await expect(replaceDocument(desk, first.id, pdf("v3"))).rejects.toThrow(/not found/);
    expect(new TextDecoder().decode((await readDocument(desk, second.id))!.body)).toContain("v2");
    expect(new TextDecoder().decode((await readDocument(desk, first.id))!.body)).toContain("v1");
    await expect(deleteDocument(desk, second.id, " ")).rejects.toThrow(/reason/);
    await deleteDocument(desk, second.id, "Uploaded to the wrong member");

    const all = await listDocuments(desk, memberId);
    expect(all.map((d) => d.status).sort()).toEqual(["DELETED", "REPLACED"]);
    expect(all.find((d) => d.id === first.id)?.replacedById).toBe(second.id);
    const actions = (await db.auditLog.findMany({ where: { orgId: gym.org.id, entity: "MemberDocument" } })).map((a) => a.action).sort();
    expect(actions).toEqual(["document.delete", "document.replace", "document.upload", "document.view", "document.view"]);
  });

  it("stays inside the gym and the branch", async () => {
    const d = await uploadDocument(desk, memberId, { kind: "Waiver", title: "Waiver" }, pdf("w"));
    const other = await makeGym();
    expect(await readDocument(await other.user("Super Admin"), d.id)).toBeNull();
    expect(await readDocument(pick(await gym.user("Receptionist"), gym.b.id), d.id)).toBeNull();
    expect(await purgeDocuments(gym.org.id, memberId)).toBe(3);
    expect(await db.memberDocument.count({ where: { memberId } })).toBe(0);
  });

  it("a storage problem comes back as a UserError the page can show, and leaves no half-written row", async () => {
    const put = vi.mocked(storage.putObject);
    const problem = "File storage is not set up: this server has no disk for files, and no S3_* bucket settings are set.";
    put.mockRejectedValueOnce(new UserError(problem));
    const n = await db.memberDocument.count({ where: { memberId } });
    await expect(uploadDocument(desk, memberId, { kind: "ID proof", title: "Aadhaar" }, pdf("storage"))).rejects.toSatisfy((e) => e instanceof UserError && e.message === problem);
    expect(await db.memberDocument.count({ where: { memberId } })).toBe(n);

    const ok = await uploadDocument(desk, memberId, { kind: "ID proof", title: "Aadhaar" }, pdf("fine"));
    put.mockRejectedValueOnce(new UserError(problem));
    await expect(replaceDocument(desk, ok.id, pdf("again"))).rejects.toThrow(UserError);
    expect((await db.memberDocument.findUniqueOrThrow({ where: { id: ok.id } })).status).toBe("ACTIVE");
    await deleteDocument(desk, ok.id, "Test file");
  });

  it("a Photo document becomes the member photo and follows replace and delete", async () => {
    const png = (n: number) => new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, n])], "p.png", { type: "image/png" });
    await expect(uploadDocument(desk, memberId, { kind: "Photo", title: "Photo" }, pdf("x"))).rejects.toThrow(/JPG, PNG or WebP/);
    const d1 = await uploadDocument(desk, memberId, { kind: "Photo", title: "Photo" }, png(1));
    expect((await db.member.findUniqueOrThrow({ where: { id: memberId } })).photoKey).toBe(d1.storageKey);
    const d2 = await replaceDocument(desk, d1.id, png(2));
    expect((await db.member.findUniqueOrThrow({ where: { id: memberId } })).photoKey).toBe(d2.storageKey);
    await deleteDocument(desk, d2.id, "Wrong photo");
    expect((await db.member.findUniqueOrThrow({ where: { id: memberId } })).photoKey).toBeNull();
    await expect(getObject(d2.storageKey)).resolves.toBeTruthy();
  });
});
