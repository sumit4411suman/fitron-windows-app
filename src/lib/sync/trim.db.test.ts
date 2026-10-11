import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { hasDb, makeGym, pick } from "@/test/db";
import { isLocal } from "@/lib/runtime/edition";
import { createMember } from "@/lib/services/members";
import { readRecord } from "./records";
import { authDevice, changesSince, linkDevice, pushOne, trimChanges } from "./server";

// Trimming fitron.in's change log (SYNC.md §4): only what every computer has, only what is old, never a record's newest
// change; a computer away for months downloads the gym again instead of holding the log back.

const PASSWORD = "Trim-test-password-1";
const DAY = 86_400_000;
const changeId = () => randomUUID().replace(/-/g, "");

async function gymWithComputer() {
  const gym = await makeGym();
  const owner = pick(await gym.user("Super Admin"), gym.a.id);
  await db.user.update({ where: { id: owner.id }, data: { passwordHash: await hashPassword(PASSWORD) } });
  const linked = await linkDevice({ email: owner.email, password: PASSWORD }, { name: "Front desk PC" });
  return { gym, owner, dev: (await authDevice(`Bearer ${linked.token}`))! };
}

const rowsOf = (orgId: string) => db.syncChange.findMany({ where: { orgId }, orderBy: { seq: "asc" }, select: { seq: true, entity: true, entityId: true } });
const age = (orgId: string, days: number) => db.$executeRaw`UPDATE "SyncChange" SET "createdAt" = now() - make_interval(days => ${days}) WHERE "orgId" = ${orgId}`;
const pulledTo = async (devId: string, seq: bigint) => db.syncDevice.update({ where: { id: devId }, data: { pulledSeq: seq } });

describe.skipIf(!hasDb || isLocal())("trimming the cloud sync change log (database)", () => {
  it("drops old changes every computer has, keeps each record's newest, and leaves the rest of the log untouched", async () => {
    const { gym, owner, dev } = await gymWithComputer();
    const m = await createMember(owner, { name: "Edited Often", gender: "Male", phone: "9812000001", source: "Walk-in", tags: [] });
    for (const name of ["Edit one", "Edit two", "Edit three"]) await db.member.update({ where: { id: m.id }, data: { name } });
    await age(gym.org.id, 100);
    const before = await rowsOf(gym.org.id);
    const mine = before.filter((r) => r.entity === "Member" && r.entityId === m.id);
    expect(mine.length).toBeGreaterThanOrEqual(4);
    // The computer has everything up to the second edit only.
    const cutoff = mine[2]!.seq;
    await pulledTo(dev.id, cutoff);
    const pageBefore = await changesSince({ ...dev, pulledSeq: cutoff }, Number(cutoff));

    const r = await trimChanges(gym.org.id);
    expect(r).toMatchObject({ below: Number(cutoff), resync: 0 });
    expect(r.removed).toBeGreaterThan(0);
    const after = await rowsOf(gym.org.id);
    // Nothing above what the computer has is touched, so its next download is the same.
    expect(after.filter((x) => x.seq > cutoff)).toEqual(before.filter((x) => x.seq > cutoff));
    expect((await changesSince({ ...dev, pulledSeq: cutoff }, Number(cutoff))).changes).toEqual(pageBefore.changes);
    // At or below it, only each record's newest change is left.
    const below = after.filter((x) => x.seq <= cutoff);
    const newest = new Map<string, bigint>();
    for (const x of before) newest.set(`${x.entity}|${x.entityId}`, x.seq);
    expect(below.every((x) => newest.get(`${x.entity}|${x.entityId}`) === x.seq)).toBe(true);
    expect(before.length - after.length).toBe(r.removed);
    // The member's version is still its newest change, and the record itself is untouched.
    expect((await db.syncChange.aggregate({ where: { orgId: gym.org.id, entity: "Member", entityId: m.id }, _max: { seq: true } }))._max.seq).toBe(mine.at(-1)!.seq);
    expect((await readRecord(db, "Member", m.id))?.name).toBe("Edit three");
    // Again: nothing more to drop.
    expect((await trimChanges(gym.org.id)).removed).toBe(0);
  });

  it("keeps changes younger than 90 days, whatever the computers have", async () => {
    const { gym, owner, dev } = await gymWithComputer();
    const m = await createMember(owner, { name: "Recent", gender: "Female", phone: "9812000002", source: "Walk-in", tags: [] });
    await db.member.update({ where: { id: m.id }, data: { name: "Recent, edited" } });
    await age(gym.org.id, 30);
    const latest = (await rowsOf(gym.org.id)).at(-1)!.seq;
    await pulledTo(dev.id, latest);
    const before = (await rowsOf(gym.org.id)).length;
    expect(await trimChanges(gym.org.id)).toMatchObject({ removed: 0 });
    expect((await rowsOf(gym.org.id)).length).toBe(before);
  });

  it("a computer away for half a year no longer holds the log back: it is told to download the gym again", async () => {
    const { gym, owner, dev } = await gymWithComputer();
    const m = await createMember(owner, { name: "Away", gender: "Male", phone: "9812000003", source: "Walk-in", tags: [] });
    await db.member.update({ where: { id: m.id }, data: { name: "Away, edited" } });
    await age(gym.org.id, 200);
    // Never pulled, last heard from 200 days ago.
    await db.syncDevice.update({ where: { id: dev.id }, data: { pulledSeq: 0n, lastSeenAt: new Date(Date.now() - 200 * DAY), linkedAt: new Date(Date.now() - 300 * DAY), resyncAt: null } });
    const r = await trimChanges(gym.org.id);
    expect(r).toMatchObject({ resync: 1 });
    expect(r.removed).toBeGreaterThan(0);
    const back = (await db.syncDevice.findUniqueOrThrow({ where: { id: dev.id } }));
    expect(back.resyncAt).not.toBeNull();
    // Its next download says so, and it downloads the whole gym before anything else.
    expect((await changesSince({ ...dev, pulledSeq: 0n, resyncAt: back.resyncAt }, 0)).resync).toBe(true);
  });

  it("a computer still in touch holds the log back at what it has, even if it is behind", async () => {
    const { gym, owner, dev } = await gymWithComputer();
    const m = await createMember(owner, { name: "Behind", gender: "Male", phone: "9812000004", source: "Walk-in", tags: [] });
    await db.member.update({ where: { id: m.id }, data: { name: "Behind, edited" } });
    await age(gym.org.id, 120);
    await db.syncDevice.update({ where: { id: dev.id }, data: { pulledSeq: 0n, lastSeenAt: new Date() } });
    const before = (await rowsOf(gym.org.id)).length;
    expect(await trimChanges(gym.org.id)).toMatchObject({ removed: 0, resync: 0, below: 0 });
    expect((await rowsOf(gym.org.id)).length).toBe(before);
  });

  it("drops an old upload receipt once the computer has uploaded since, and keeps it until then", async () => {
    const { gym, owner, dev } = await gymWithComputer();
    const template = (await readRecord(db, "Member", (await createMember(owner, { name: "Template", gender: "Female", phone: "9812000005", source: "Walk-in", tags: [] })).id))!;
    const send = async (n: number) => {
      const id = `m_${changeId().slice(0, 20)}`;
      const it = { changeId: changeId(), entity: "Member", entityId: id, op: "upsert" as const, data: { ...template, id, code: `FT-10000${n}`, name: `Uploaded ${n}`, phone: `981200010${n}` }, baseVersion: 0 };
      expect(await pushOne(dev, it)).toMatchObject({ status: "applied" });
      return it.changeId;
    };
    const first = await send(1);
    await db.syncApplied.update({ where: { changeId: first }, data: { appliedAt: new Date(Date.now() - 100 * DAY) } });
    // The only upload so far: its answer may never have arrived, so its receipt stays.
    expect((await trimChanges(gym.org.id)).receipts).toBe(0);
    await send(2);
    expect((await trimChanges(gym.org.id)).receipts).toBe(1);
    expect(await db.syncApplied.findUnique({ where: { changeId: first } })).toBeNull();
    expect(await db.syncApplied.count({ where: { orgId: gym.org.id } })).toBe(1);
  });
});
