import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { audit, verifyAuditChain } from "./audit";
import { hasDb, makeGym } from "@/test/db";

const w = (orgId: string, n: number, extra: Record<string, unknown> = {}) => db.$transaction((tx) => audit(tx, { orgId, userId: null, action: "x.test", entity: "Thing", entityId: `t${n}`, ...extra }));

describe.skipIf(!hasDb)("audit chain", () => {
  it("chains entries per organisation and verifies", async () => {
    const g = await makeGym();
    await w(g.org.id, 1, { after: { branchId: g.a.id } });
    await w(g.org.id, 2);
    await w(g.org.id, 3);
    const rows = await db.auditLog.findMany({ where: { orgId: g.org.id }, orderBy: { id: "asc" } });
    expect(rows[0]!.prevHash).toBe("0000");
    expect(rows[1]!.prevHash).toBe(rows[0]!.hash);
    expect(rows[2]!.prevHash).toBe(rows[1]!.hash);
    expect(rows[0]!.branchId).toBe(g.a.id);
    expect(rows[1]!.branchId).toBeNull();
    expect(await verifyAuditChain(g.org.id)).toEqual({ checked: 3, bad: 0 });
    // a second organisation starts its own chain
    const g2 = await makeGym();
    await w(g2.org.id, 1);
    expect((await db.auditLog.findFirstOrThrow({ where: { orgId: g2.org.id } })).prevHash).toBe("0000");
  });

  it("detects a tampered entry", async () => {
    const g = await makeGym();
    for (const n of [1, 2, 3]) await w(g.org.id, n);
    const mid = (await db.auditLog.findMany({ where: { orgId: g.org.id }, orderBy: { id: "asc" } }))[1]!;
    // The database refuses to change an audit row (financial-guard.db.test.ts). Someone who owns the database could switch that
    // off and edit history, which is the case the chain exists for, so the test does the same.
    await db.$executeRawUnsafe('ALTER TABLE "AuditLog" DISABLE TRIGGER fitron_audit_append_only');
    try {
      await db.$executeRaw`UPDATE "AuditLog" SET action = 'x' WHERE id = ${mid.id}`;
    } finally {
      await db.$executeRawUnsafe('ALTER TABLE "AuditLog" ENABLE TRIGGER fitron_audit_append_only');
    }
    expect(await verifyAuditChain(g.org.id)).toEqual({ checked: 3, bad: 1 });
  });

  it("stays a single chain under concurrent writers", async () => {
    const g = await makeGym();
    await Promise.all(Array.from({ length: 10 }, (_, i) => w(g.org.id, i)));
    const rows = await db.auditLog.findMany({ where: { orgId: g.org.id } });
    expect(new Set(rows.map((r) => r.prevHash)).size).toBe(10);
    expect(await verifyAuditChain(g.org.id)).toEqual({ checked: 10, bad: 0 });
  });

  it("round-trips nested json through jsonb", async () => {
    const g = await makeGym();
    await w(g.org.id, 1, { before: { z: 1, a: { y: null, x: "नमस्ते ₹" } }, after: { list: [3, { b: 1, a: 2 }], n: 1.5, s: "é" } });
    expect(await verifyAuditChain(g.org.id)).toEqual({ checked: 1, bad: 0 });
  });
});
