import { describe, expect, it } from "vitest";
import { changedFields, fromWire, keyFields, keyOf, keyWhere, SyncDataError, toWire } from "./codec";

// One spelling per type on the wire, whichever database a row came from; money stays whole paise.

describe("the wire format", () => {
  it("reads PostgreSQL's to_jsonb and a Prisma row the same way", () => {
    const fromPg = toWire("Payment", { id: "p1", orgId: "o1", code: "PAY-1", branchId: "b1", invoiceId: "i1", memberId: "m1", date: "2026-10-11", amount: 150000, method: "UPI", status: "SUCCESS", receivedById: "u1", createdAt: "2026-10-11T23:15:00.5+05:30" });
    const fromPrisma = toWire("Payment", { id: "p1", orgId: "o1", code: "PAY-1", branchId: "b1", invoiceId: "i1", memberId: "m1", date: new Date("2026-10-11T00:00:00Z"), amount: 150000, method: "UPI", status: "SUCCESS", receivedById: "u1", createdAt: new Date("2026-10-11T17:45:00.500Z") });
    expect(fromPg).toEqual(fromPrisma);
    expect(fromPg.date).toBe("2026-10-11T00:00:00.000Z");
    expect(fromPg.createdAt).toBe("2026-10-11T17:45:00.500Z");
  });

  it("spells booleans, decimals, bytes and lists one way", () => {
    const m = toWire("Member", { id: "m1", walkIn: 0, tags: '["vip","morning"]' });
    expect(m).toEqual({ id: "m1", walkIn: false, tags: ["vip", "morning"] });
    const it2 = toWire("InvoiceItem", { id: "x", taxRate: 18.0 });
    expect(it2.taxRate).toBe("18");
    expect(toWire("InvoiceItem", { id: "x", taxRate: { toString: () => "2.50" } }).taxRate).toBe("2.5");
  });

  it("leaves out what never syncs: passwords and two-step secrets", () => {
    const u = toWire("User", { id: "u1", email: "a@b.in", passwordHash: "$argon2id$x", totpSecret: Buffer.from("s"), lastLoginAt: new Date() });
    expect(u).toEqual({ id: "u1", email: "a@b.in" });
    expect(fromWire("User", { id: "u1", passwordHash: "x" }).passwordHash).toBeUndefined();
  });

  it("refuses money that is not whole paise, fields that do not exist and missing required values", () => {
    expect(() => fromWire("Payment", { id: "p1", amount: 1500.5 })).toThrow(SyncDataError);
    expect(() => fromWire("Payment", { id: "p1", amount: "1500" })).toThrow(/whole number/);
    expect(() => fromWire("Payment", { id: "p1", hackedColumn: 1 })).toThrow(/no such field/);
    expect(() => fromWire("Payment", { id: "p1", amount: null })).toThrow(/required/);
    expect(fromWire("Payment", { id: "p1", amount: 150000, date: "2026-10-11T00:00:00.000Z" })).toEqual({ id: "p1", amount: 150000, date: new Date("2026-10-11T00:00:00.000Z") });
  });

  it("names composite records by their keys joined with |", () => {
    expect(keyOf("Setting", { orgId: "o1", key: "tax", value: {} })).toBe("o1|tax");
    expect(keyFields("UserBranch", "u1|b1")).toEqual({ userId: "u1", branchId: "b1" });
    expect(keyWhere("PlanPrice", "p1|Student")).toEqual({ planId_category: { planId: "p1", category: "Student" } });
    expect(keyWhere("Member", "m1")).toEqual({ id: "m1" });
    expect(() => keyFields("UserBranch", "u1")).toThrow(SyncDataError);
  });

  it("finds the fields that differ, Json compared by value", () => {
    expect(changedFields("Setting", { orgId: "o", key: "k", value: { a: 1, b: 2 } }, { orgId: "o", key: "k", value: { b: 2, a: 1 } })).toEqual([]);
    expect(changedFields("Member", { id: "m", name: "A", phone: "1" }, { id: "m", name: "B", phone: "1" })).toEqual(["name"]);
  });
});
