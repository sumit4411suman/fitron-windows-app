import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// This file gets a database of its own: linking a computer switches on change capture and number ranges for the whole
// file, which must not reach the other test files sharing the suite's database.
const dir = await vi.hoisted(async () => {
  const [{ mkdtempSync: mk }, { default: o }, { default: p }] = await Promise.all([import("node:fs"), import("node:os"), import("node:path")]);
  const d = mk(p.join(o.tmpdir(), "fitron-sync-client-"));
  process.env.DATABASE_URL = `file:${p.join(d, "fitron.db")}`;
  return d;
});

const cloud = vi.hoisted(() => ({ calls: [] as { path: string; body?: unknown }[], handler: (async () => ({})) as (p: string, body?: unknown) => Promise<unknown> }));
vi.mock("@/lib/integrations/sync", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/integrations/sync")>();
  return {
    ...real,
    cloudCall: vi.fn(async (_base: string, p: string, o?: { body?: unknown }) => {
      cloud.calls.push({ path: p, body: o?.body });
      return cloud.handler(p, o?.body);
    }),
  };
});

import { db } from "@/lib/db";
import { isLocal } from "@/lib/runtime/edition";
import { migrateLocal } from "@/lib/runtime/local-migrate";
import { makeGym, pick } from "@/test/db";
import { createMember, updateMember } from "@/lib/services/members";
import { runLocalDailyJobs, ON_FITRON_IN } from "@/lib/services/jobs";
import { todayIso } from "@/lib/services/time";
import { readRecord } from "./records";
import { dismissFailed, pullAll, pushPending, readState, retryFailed, sealToken, syncOnce } from "./client";
import type { ChangesPage, PushItem, PushResult, SnapshotPage } from "./protocol";

type Gym = Awaited<ReturnType<typeof makeGym>>;

describe.skipIf(!isLocal())("cloud sync on the computer (database)", () => {
  let gym: Gym;
  let owner: Awaited<ReturnType<Gym["user"]>>;
  const conn = async () => ({ base: "http://127.0.0.1:1", token: "fsd_test", state: (await readState())! });
  const pending = () => db.syncChange.findMany({ where: { status: "PENDING" }, orderBy: { seq: "asc" } });
  const newMember = (name: string, phone: string) => createMember(owner, { name, gender: "Male", phone, source: "Walk-in", tags: [] });

  beforeAll(async () => {
    migrateLocal(path.join(dir, "fitron.db"), path.join(process.cwd(), "prisma", "local-migrations"));
    gym = await makeGym();
    owner = pick(await gym.user("Super Admin"), gym.a.id);
  });
  beforeEach(() => {
    cloud.calls.length = 0;
  });

  it("records nothing until linked; then every change waits to go up, numbered from the computer's own range", async () => {
    const before = await newMember("Before Linking", "9822000001");
    expect(await db.syncChange.count()).toBe(0);
    await db.syncState.create({ data: { id: 1, linked: true, orgId: gym.org.id, deviceId: "dev_1", deviceNo: 3, token: sealToken("fsd_test"), cloudUrl: "http://127.0.0.1:1" } });
    const after = await newMember("After Linking", "9822000002");
    expect((await pending()).map((c) => [c.entity, c.entityId])).toContainEqual(["Member", after.id]);
    expect(Number(after.code.replace(/\D/g, ""))).toBeGreaterThan(3_000_000);
    expect(Number(before.code.replace(/\D/g, ""))).toBeLessThan(1_000_000);
  });

  it("uploads each record once with its newest state, and marks only what fitron.in confirmed", async () => {
    await db.syncChange.updateMany({ where: { status: "PENDING" }, data: { status: "DONE" } });
    const m = await newMember("Coalesce Me", "9822000003");
    await updateMember(owner, m.id, { name: "Coalesce Me 2", gender: "Male", phone: "9822000003", source: "Walk-in", tags: [] });
    await updateMember(owner, m.id, { name: "Coalesce Me 3", gender: "Male", phone: "9822000003", source: "Walk-in", tags: [] });
    const rows = (await pending()).filter((r) => r.entityId === m.id);
    expect(rows.length).toBeGreaterThanOrEqual(3);
    cloud.handler = async (p, body) => {
      expect(p).toBe("/api/sync/push");
      const items = (body as { items: PushItem[] }).items;
      const mine = items.filter((i) => i.entityId === m.id);
      expect(mine).toHaveLength(1);
      expect(mine[0]).toMatchObject({ changeId: rows[rows.length - 1]!.changeId, op: "upsert", baseVersion: 0, data: { name: "Coalesce Me 3" } });
      // The desk changes the record again while the upload is on its way.
      await db.member.update({ where: { id: m.id }, data: { notes: "typed meanwhile" } });
      return { results: items.map((i): PushResult => ({ changeId: i.changeId, status: "applied", version: 42 })) };
    };
    expect(await pushPending(await conn())).toBeGreaterThan(0);
    expect(await db.syncChange.count({ where: { entityId: m.id, seq: { in: rows.map((r) => r.seq) }, status: "DONE" } })).toBe(rows.length);
    expect((await pending()).filter((r) => r.entityId === m.id)).toHaveLength(1); // the change made meanwhile still waits
    expect(await db.syncVersion.findUnique({ where: { entity_entityId: { entity: "Member", entityId: m.id } } })).toMatchObject({ version: BigInt(42) });
    expect((await db.member.findUniqueOrThrow({ where: { id: m.id } })).notes).toBe("typed meanwhile");
  });

  it("keeps a refused change with its reason, sends it again on Retry, or keeps it here on Dismiss", async () => {
    await db.syncChange.updateMany({ where: { status: "PENDING" }, data: { status: "DONE" } });
    const m = await newMember("Refused", "9822000004");
    cloud.handler = async (_p, body) => ({ results: (body as { items: PushItem[] }).items.map((i): PushResult => ({ changeId: i.changeId, status: "rejected", reason: "Another record on fitron.in already uses this number, phone or email." })) });
    await pushPending(await conn());
    const refused = await db.syncChange.findFirstOrThrow({ where: { entityId: m.id, status: "REJECTED" } });
    expect(refused.error).toMatch(/already uses this number/);
    expect(await retryFailed([refused.seq])).toBe(1);
    expect((await pending()).filter((r) => r.entityId === m.id)).toHaveLength(1);
    await pushPending(await conn());
    expect(await dismissFailed()).toBeGreaterThan(0);
    expect(await db.syncChange.count({ where: { status: "REJECTED" } })).toBe(0);
  });

  it("when the website's record stands, stores it here and keeps this computer's version under Conflicts", async () => {
    await db.syncChange.updateMany({ where: { status: "PENDING" }, data: { status: "DONE" } });
    const m = await newMember("Conflicted", "9822000005");
    const website = { ...(await readRecord(db, "Member", m.id))!, name: "Website Name" };
    cloud.handler = async (_p, body) => ({
      results: (body as { items: PushItem[] }).items.map((i): PushResult => (i.entityId === m.id ? { changeId: i.changeId, status: "conflict", version: 77, current: website, conflict: { kind: "kept-website", fields: ["name"], ours: i.data, theirs: website } } : { changeId: i.changeId, status: "applied", version: 1 })),
    });
    await pushPending(await conn());
    expect((await db.member.findUniqueOrThrow({ where: { id: m.id } })).name).toBe("Website Name");
    expect(await db.syncConflict.findFirst({ where: { entityId: m.id } })).toMatchObject({ kind: "kept-website", fields: "name" });
    // Writing the website's version here is not a change of this computer's.
    expect((await pending()).filter((r) => r.entityId === m.id)).toHaveLength(0);
  });

  it("applies downloads with their checkpoint, skips records waiting to go up, and records nothing as this computer's", async () => {
    await db.syncChange.updateMany({ where: { status: "PENDING" }, data: { status: "DONE" } });
    const template = (await readRecord(db, "Member", (await newMember("Template", "9822000006")).id))!;
    await db.syncChange.updateMany({ where: { status: "PENDING" }, data: { status: "DONE" } });
    const busy = await newMember("Busy Here", "9822000007"); // waiting to go up
    const busyWire = { ...(await readRecord(db, "Member", busy.id))!, name: "Website Overwrite" };
    const lead = await db.lead.create({ data: { orgId: gym.org.id, branchId: gym.a.id, name: "Old Lead", phone: "9822000008", source: "Walk-in", interest: "Membership", ownerId: owner.id } });
    await db.syncChange.updateMany({ where: { entityId: lead.id }, data: { status: "DONE" } });
    const st = await readState();
    const from = Number(st!.pulledSeq);
    const page: ChangesPage = {
      changes: [
        { seq: from + 1, entity: "Member", entityId: "m_from_cloud_1", op: "upsert", data: { ...template, id: "m_from_cloud_1", code: "FT-9", name: "From Website", phone: "9822000009" }, origin: "cloud" },
        { seq: from + 2, entity: "Member", entityId: busy.id, op: "upsert", data: busyWire, origin: "cloud" },
        { seq: from + 3, entity: "Lead", entityId: lead.id, op: "delete", data: null, origin: "cloud" },
      ],
      next: from + 3,
      latest: from + 3,
      more: false,
      resync: false,
    };
    cloud.handler = async () => page;
    const outboxBefore = await db.syncChange.count();
    expect(await pullAll(await conn())).toBe(3);
    expect((await db.member.findUniqueOrThrow({ where: { id: "m_from_cloud_1" } })).name).toBe("From Website");
    expect((await db.member.findUniqueOrThrow({ where: { id: busy.id } })).name).toBe("Busy Here");
    expect(await db.lead.count({ where: { id: lead.id } })).toBe(0);
    expect(Number((await readState())!.pulledSeq)).toBe(from + 3);
    expect(await db.syncVersion.findUnique({ where: { entity_entityId: { entity: "Member", entityId: "m_from_cloud_1" } } })).toMatchObject({ version: BigInt(from + 1) });
    expect(await db.syncChange.count()).toBe(outboxBefore);
  });

  it("does not move the checkpoint when the computer's transaction fails, and a record it cannot take is kept for the owner", async () => {
    const from = Number((await readState())!.pulledSeq);
    const template = (await readRecord(db, "Member", "m_from_cloud_1"))!;
    cloud.handler = async () => ({ changes: [{ seq: from + 1, entity: "Member", entityId: "m_from_cloud_2", op: "upsert", data: { ...template, id: "m_from_cloud_2", code: "FT-10", phone: "9822000010" }, origin: "cloud" }], next: from + 1, latest: from + 1, more: false, resync: false }) satisfies ChangesPage;
    const spy = vi.spyOn(db, "$transaction").mockRejectedValueOnce(new Error("disk I/O error"));
    await expect(pullAll(await conn())).rejects.toThrow("disk I/O error");
    spy.mockRestore();
    expect(Number((await readState())!.pulledSeq)).toBe(from);
    expect(await db.member.count({ where: { id: "m_from_cloud_2" } })).toBe(0);
    // A batch with one record this database refuses: the rest goes in, the refused one is kept, the checkpoint moves on.
    cloud.handler = async () =>
      ({
        changes: [
          { seq: from + 1, entity: "Member", entityId: "m_from_cloud_2", op: "upsert", data: { ...template, id: "m_from_cloud_2", code: "FT-10", phone: "9822000010" }, origin: "cloud" },
          { seq: from + 2, entity: "Member", entityId: "m_from_cloud_3", op: "upsert", data: { ...template, id: "m_from_cloud_3", code: "FT-11", phone: "9822000010" }, origin: "cloud" },
        ],
        next: from + 2,
        latest: from + 2,
        more: false,
        resync: false,
      }) satisfies ChangesPage;
    await pullAll(await conn());
    expect(await db.member.count({ where: { id: "m_from_cloud_2" } })).toBe(1);
    expect(await db.member.count({ where: { id: "m_from_cloud_3" } })).toBe(0);
    expect(await db.syncConflict.findFirst({ where: { entityId: "m_from_cloud_3", kind: "not-applied" } })).toBeTruthy();
    expect(Number((await readState())!.pulledSeq)).toBe(from + 2);
  });

  it("leaves the daily jobs to fitron.in while linked", async () => {
    const out = await runLocalDailyJobs(gym.org.id, todayIso());
    expect(out.length).toBeGreaterThan(5);
    expect(out.every((j) => j.status === "skipped" && (j.result as { note?: string }).note === ON_FITRON_IN)).toBe(true);
  });

  it("after a restore, downloads the whole gym first: what fitron.in no longer has goes, money is kept and listed", async () => {
    await db.syncChange.updateMany({ where: { status: "PENDING" }, data: { status: "DONE" } });
    const stray = await db.lead.create({ data: { orgId: gym.org.id, branchId: gym.a.id, name: "Stray Lead", phone: "9822000011", source: "Walk-in", interest: "Membership", ownerId: owner.id } });
    await db.syncChange.updateMany({ where: { status: "PENDING" }, data: { status: "DONE" } });
    await db.syncState.update({ where: { id: 1 }, data: { needsSnapshot: true } });
    const order: string[] = [];
    cloud.handler = async (p) => {
      order.push(p.split("?")[0]!);
      if (p.startsWith("/api/sync/snapshot")) {
        const entity = new URL(`http://x${p}`).searchParams.get("entity")!;
        // fitron.in has this computer's members (as they are) and nothing else.
        const rows = entity === "Member" ? await Promise.all((await db.member.findMany({ where: { orgId: gym.org.id } })).map(async (m) => ({ data: (await readRecord(db, "Member", m.id))!, version: 5 }))) : [];
        return { entity, rows, last: null, seq: 500 } satisfies SnapshotPage;
      }
      if (p.startsWith("/api/sync/push")) return { results: [] };
      return { changes: [], next: 500, latest: 500, more: false, resync: false } satisfies ChangesPage;
    };
    const r = await syncOnce("http://127.0.0.1:1");
    expect(r?.resynced).toBe(true);
    expect(order[0]).toBe("/api/sync/snapshot");
    expect(await db.lead.count({ where: { id: stray.id } })).toBe(0);
    expect(await db.syncConflict.count({ where: { kind: "only-here", entity: "Invoice" } })).toBe(await db.invoice.count({ where: { orgId: gym.org.id } }));
    expect(await readState()).toMatchObject({ needsSnapshot: false, pulledSeq: BigInt(500) });
  });
});
