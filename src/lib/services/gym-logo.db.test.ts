import { beforeAll, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { db } from "@/lib/db";
import { hasDb, makeGym } from "@/test/db";
import { MAX_LOGO_BYTES, readGymLogo, removeGymLogo, setGymLogo } from "./gym-logo";
import { getGymProfile } from "./settings";

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3];
const png = () => new File([new Uint8Array(PNG)], "logo.png", { type: "image/png" });

describe.skipIf(!hasDb)("gym logo (database)", () => {
  let gym: Awaited<ReturnType<typeof makeGym>>;
  let dir: string;
  const actions = (orgId: string) => db.auditLog.findMany({ where: { orgId, entity: "Setting", entityId: "gym" }, orderBy: { id: "asc" }, select: { action: true } }).then((r) => r.map((x) => x.action));

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "fitron-logo-"));
    vi.stubEnv("STORAGE_DIR", dir);
    vi.stubEnv("S3_BUCKET", "");
    gym = await makeGym();
  });

  it("refuses an empty, oversized or non-image file", async () => {
    const admin = await gym.user("Super Admin");
    await expect(setGymLogo(admin, new File([], "empty.png"))).rejects.toThrow("Choose a logo.");
    await expect(setGymLogo(admin, new File([new Uint8Array(MAX_LOGO_BYTES + 1)], "big.png"))).rejects.toThrow("Logo must be under 1 MB.");
    await expect(setGymLogo(admin, new File(["%PDF-1.4 not a logo"], "x.pdf"))).rejects.toThrow("Use a PNG or JPG logo.");
    expect((await getGymProfile(admin.orgId)).logoKey).toBeUndefined();
  });

  it("stores the logo privately, replaces it, serves it to the gym only and removes it", async () => {
    const admin = await gym.user("Super Admin");
    const other = await makeGym();

    await setGymLogo(admin, png());
    const first = (await getGymProfile(admin.orgId)).logoKey!;
    expect(first.startsWith(`${admin.orgId}/gym/logo-`)).toBe(true);
    expect(first.endsWith(".png")).toBe(true);
    expect(existsSync(path.join(dir, first))).toBe(true);
    const read = await readGymLogo(admin.orgId);
    expect(read?.mime).toBe("image/png");
    expect(Array.from(read!.body)).toEqual(PNG);
    expect(await readGymLogo(other.org.id)).toBeNull();

    await setGymLogo(admin, png());
    const second = (await getGymProfile(admin.orgId)).logoKey!;
    expect(second).not.toBe(first);
    expect(existsSync(path.join(dir, first))).toBe(false);
    expect(existsSync(path.join(dir, second))).toBe(true);

    await removeGymLogo(admin);
    expect((await getGymProfile(admin.orgId)).logoKey).toBeNull();
    expect(existsSync(path.join(dir, second))).toBe(false);
    expect(await readGymLogo(admin.orgId)).toBeNull();
    const after = await actions(admin.orgId);
    await removeGymLogo(admin); // nothing to remove: no audit row
    expect(await actions(admin.orgId)).toEqual(after);
    expect(after.filter((a) => a !== "setting.update")).toEqual(["gym.logo", "gym.logo", "gym.logo.remove"]);
  });
});
