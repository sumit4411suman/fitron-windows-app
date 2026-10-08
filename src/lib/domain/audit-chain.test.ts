import { describe, expect, it } from "vitest";
import { GENESIS, canonical, chainHash, verifyChain, type ChainEntry } from "./audit-chain";

const base: ChainEntry = { orgId: "o", userId: "u", actorType: "USER", action: "member.create", entity: "Member", entityId: "m1", branchId: "b", createdAt: new Date("2026-01-01T00:00:00Z"), before: null, after: { a: 1, b: { y: 2, x: 1 } } };

function build(n: number, unhashed = 0) {
  const rows: (ChainEntry & { hash: string | null; prevHash: string | null })[] = [];
  for (let i = 0; i < unhashed; i++) rows.push({ ...base, entityId: `old${i}`, hash: null, prevHash: null });
  let prev = GENESIS;
  for (let i = 0; i < n; i++) {
    const e = { ...base, entityId: `e${i}`, createdAt: new Date(2026, 0, 2 + i) };
    const hash = chainHash(prev, e);
    rows.push({ ...e, hash, prevHash: prev });
    prev = hash;
  }
  return rows;
}

describe("audit chain", () => {
  it("canonical sorts keys recursively", () => {
    expect(canonical({ b: 1, a: { d: [{ z: 1, y: undefined }], c: null } })).toBe(canonical({ a: { c: null, d: [{ z: 1 }] }, b: 1 }));
    expect(canonical({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });
  it("hashes deterministically and covers every field", () => {
    const h = chainHash(GENESIS, base);
    expect(chainHash(GENESIS, base)).toBe(h);
    expect(chainHash(GENESIS, { ...base, after: { b: { x: 1, y: 2 }, a: 1 } })).toBe(h);
    for (const change of [{ action: "x" }, { entityId: "z" }, { branchId: null }, { createdAt: new Date("2026-01-02") }, { before: { a: 1 } }, { after: { a: 2 } }]) expect(chainHash(GENESIS, { ...base, ...change })).not.toBe(h);
    expect(chainHash("abcd", base)).not.toBe(h);
  });
  it("verifies a chain after unhashed entries", () => {
    expect(verifyChain(build(3, 2))).toMatchObject({ checked: 3, bad: 0 });
    expect(verifyChain([])).toMatchObject({ checked: 0, bad: 0 });
  });
  it("flags tampering", () => {
    const rows = build(3);
    rows[1]!.action = "tampered";
    expect(verifyChain(rows).bad).toBe(1);
    const swapped = build(3);
    swapped[2]!.prevHash = GENESIS;
    expect(verifyChain(swapped).bad).toBeGreaterThanOrEqual(1);
  });
});
