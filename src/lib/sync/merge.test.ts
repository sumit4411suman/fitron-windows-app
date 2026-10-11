import { describe, expect, it } from "vitest";
import { decide } from "./merge";

// SYNC.md §6: what happens when the website changed a record the computer also changed.

const member = (o: Record<string, unknown>) => ({ id: "m1", orgId: "o1", name: "Ravi", phone: "9800000001", email: null, ...o });

describe("conflict rules", () => {
  it("applies the computer's change as it is when nobody else touched the record", () => {
    expect(decide({ entity: "Member", base: null, baseKnown: true, current: member({}), incoming: member({ name: "Ravi K" }), contested: false })).toEqual({ action: "apply", data: member({ name: "Ravi K" }) });
  });

  it("merges a member's fields changed on different sides, with no conflict", () => {
    const d = decide({ entity: "Member", base: member({}), baseKnown: true, current: member({ phone: "9800000002" }), incoming: member({ name: "Ravi K" }), contested: true });
    expect(d).toEqual({ action: "apply", data: member({ name: "Ravi K", phone: "9800000002" }) });
  });

  it("when both changed the same field, the computer's (confirmed later) stands and both versions are kept", () => {
    const d = decide({ entity: "Member", base: member({}), baseKnown: true, current: member({ phone: "9800000002" }), incoming: member({ phone: "9800000003", name: "R" }), contested: true });
    expect(d.action).toBe("apply");
    expect(d.action === "apply" && d.data).toEqual(member({ phone: "9800000003", name: "R" }));
    expect(d.conflict).toMatchObject({ kind: "merged", fields: ["phone"], theirs: member({ phone: "9800000002" }) });
  });

  it("keeps the website's money record and sets the computer's change aside", () => {
    const inv = { id: "i1", orgId: "o1", number: "INV-1", status: "CANCELLED", total: 150000 };
    const d = decide({ entity: "Invoice", base: { ...inv, status: "ISSUED" }, baseKnown: true, current: inv, incoming: { ...inv, status: "ISSUED", pdfKey: "x" }, contested: true });
    expect(d).toMatchObject({ action: "keep", conflict: { kind: "kept-website", theirs: inv } });
  });

  it("a delete wins over a concurrent edit, and the edit is kept", () => {
    const lead = { id: "l1", orgId: "o1", name: "Asha" };
    expect(decide({ entity: "Lead", base: lead, baseKnown: true, current: null, incoming: { ...lead, name: "Asha P" }, contested: true })).toMatchObject({ action: "keep", conflict: { kind: "deleted", ours: { name: "Asha P" }, theirs: null } });
    expect(decide({ entity: "Lead", base: lead, baseKnown: true, current: { ...lead, name: "Asha W" }, incoming: null, contested: true })).toMatchObject({ action: "apply", data: null, conflict: { kind: "deleted", theirs: { name: "Asha W" } } });
  });

  it("settings: the later confirmed write wins", () => {
    const s = { orgId: "o1", key: "tax", value: { gstin: "A" } };
    expect(decide({ entity: "Setting", base: s, baseKnown: true, current: { ...s, value: { gstin: "B" } }, incoming: { ...s, value: { gstin: "C" } }, contested: true })).toEqual({ action: "apply", data: { ...s, value: { gstin: "C" } } });
  });
});
