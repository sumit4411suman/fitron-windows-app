import { beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { db } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { hasDb, makeGym } from "@/test/db";
import { changePassword, getProfile, readProfilePhoto, removeProfilePhoto, setProfilePhoto, updateProfile } from "./profile";

const png = () => new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])], "me.png", { type: "image/png" });
const session = (userId: string, id: string) => db.session.create({ data: { id, userId, expiresAt: new Date(Date.now() + 86_400_000) } });

describe.skipIf(!hasDb)("My profile (database)", () => {
  let gym: Awaited<ReturnType<typeof makeGym>>;

  beforeAll(async () => {
    vi.stubEnv("STORAGE_DIR", mkdtempSync(path.join(tmpdir(), "fitron-profile-")));
    vi.stubEnv("S3_BUCKET", "");
    gym = await makeGym();
  });

  it("saves name and mobile and audits the change", async () => {
    const me = await gym.user("Receptionist");
    await updateProfile(me, { name: "Asha Rao", phone: "9876500011" });
    const p = await getProfile(me, null);
    expect([p.name, p.phone]).toEqual(["Asha Rao", "9876500011"]);
    expect(p.activity.map((a) => a.action)).toEqual(["profile.update"]);
  });

  it("changes the password only with the right current one, and signs out other devices", async () => {
    const me = await gym.user("Trainer");
    await db.user.update({ where: { id: me.id }, data: { passwordHash: await hashPassword("old-password-1") } });
    const here = await session(me.id, `here-${me.id}`);
    await session(me.id, `there-${me.id}`);

    await expect(changePassword(me, here.id, { current: "wrong", password: "new-password-22", confirm: "new-password-22" })).rejects.toThrow(/current password is wrong/);
    await expect(changePassword(me, here.id, { current: "old-password-1", password: "old-password-1", confirm: "old-password-1" })).rejects.toThrow(/different/);
    await changePassword(me, here.id, { current: "old-password-1", password: "new-password-22", confirm: "new-password-22" });

    const { passwordHash } = await db.user.findUniqueOrThrow({ where: { id: me.id } });
    expect(await verifyPassword(passwordHash, "new-password-22")).toBe(true);
    expect((await db.session.findMany({ where: { userId: me.id } })).map((s) => s.id)).toEqual([here.id]);
  });

  it("stores a photo privately, replaces it and removes it", async () => {
    const me = await gym.user("Accountant");
    const colleague = await gym.user("Receptionist");
    const outsider = await (await makeGym()).user("Super Admin");

    await expect(setProfilePhoto(me, new File(["%PDF-1.4"], "x.pdf"))).rejects.toThrow(/JPG, PNG or WebP/);
    await setProfilePhoto(me, png());
    const first = (await db.user.findUniqueOrThrow({ where: { id: me.id } })).photoKey;
    await setProfilePhoto(me, png());
    const second = (await db.user.findUniqueOrThrow({ where: { id: me.id } })).photoKey;
    expect(second).not.toBe(first);

    expect((await readProfilePhoto(colleague, me.id))?.mime).toBe("image/png");
    expect(await readProfilePhoto(outsider, me.id)).toBeNull();

    await removeProfilePhoto(me);
    expect((await db.user.findUniqueOrThrow({ where: { id: me.id } })).photoKey).toBeNull();
    expect(await readProfilePhoto(colleague, me.id)).toBeNull();
  });
});
