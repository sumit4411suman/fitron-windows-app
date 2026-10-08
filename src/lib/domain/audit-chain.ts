import { createHash } from "node:crypto";

/** The "previous hash" of an organisation's first hashed entry. */
export const GENESIS = "0000";

/** JSON with object keys sorted recursively, so the hash does not depend on jsonb key order. */
export function canonical(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return `[${v.map((x) => (x === undefined ? "null" : canonical(x))).join(",")}]`;
  if (typeof v === "object" && v !== null) {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}

export type ChainEntry = {
  prevHash?: string | null;
  orgId: string;
  userId?: string | null;
  actorType: string;
  action: string;
  entity: string;
  entityId: string;
  branchId?: string | null;
  createdAt: Date;
  before?: unknown;
  after?: unknown;
};

export const auditPayload = (e: ChainEntry & { prevHash: string }) =>
  [e.prevHash, e.orgId, e.userId ?? "", e.actorType, e.action, e.entity, e.entityId, e.branchId ?? "", e.createdAt.toISOString(), canonical(e.before ?? null), canonical(e.after ?? null)].join("|");

export const chainHash = (prevHash: string, e: ChainEntry) => createHash("sha256").update(auditPayload({ ...e, prevHash })).digest("hex");

/** Walks entries oldest to newest; entries without a hash predate hashing and are skipped. */
export function verifyChain(rows: Iterable<ChainEntry & { hash?: string | null }>) {
  let checked = 0;
  let bad = 0;
  let lastHash = GENESIS;
  for (const r of rows) {
    if (r.hash == null) continue;
    checked++;
    if (r.prevHash !== lastHash || chainHash(lastHash, r) !== r.hash) bad++;
    lastHash = r.hash;
  }
  return { checked, bad, lastHash };
}
