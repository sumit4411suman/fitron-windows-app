import "server-only";
import { cache } from "react";
import { lockKey } from "@/lib/db-dialect";
import { cookies, headers } from "next/headers";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { BRANCH_COOKIE } from "@/lib/auth/current";
import { GENESIS, chainHash, verifyChain } from "@/lib/domain/audit-chain";

type Tx = Prisma.TransactionClient;

const json = (v: unknown) => (v === undefined ? undefined : (JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue));

/** Who is writing, from the request: read once per request (React cache), not once per audit row, so a bulk import doesn't await headers() and cookies() per row. */
const requestMeta = cache(async (): Promise<{ ip: string | null; userAgent: string | null; cookieBranch: string | null }> => {
  let ip: string | null = null;
  let userAgent: string | null = null;
  let cookieBranch: string | null = null;
  try {
    const h = await headers();
    ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
    userAgent = h.get("user-agent")?.slice(0, 300) ?? null;
  } catch {
    // Outside a request (seed, jobs).
  }
  try {
    const c = (await cookies()).get(BRANCH_COOKIE)?.value;
    cookieBranch = c && c !== "ALL" ? c : null;
  } catch {
    // No request.
  }
  return { ip, userAgent, cookieBranch };
});

/** Rule 10: every write to core tables leaves an audit row in the same transaction, chained by hash onto the organisation's previous entry. */
export async function audit(
  tx: Tx,
  a: { orgId: string; userId: string | null; action: string; entity: string; entityId: string; before?: unknown; after?: unknown; branchId?: string | null },
) {
  const { ip, userAgent, cookieBranch } = await requestMeta();
  // Serialise writers per organisation so two transactions cannot chain onto the same previous hash.
  await lockKey(tx, a.orgId);
  const prev = await tx.auditLog.findFirst({ where: { orgId: a.orgId, hash: { not: null } }, orderBy: { id: "desc" }, select: { hash: true } });
  const prevHash = prev?.hash ?? GENESIS;
  const before = json(a.before);
  const after = json(a.after);
  const inner = (v: unknown) => (v && typeof v === "object" && typeof (v as { branchId?: unknown }).branchId === "string" ? ((v as { branchId: string }).branchId) : null);
  const branchId = a.branchId ?? inner(after) ?? inner(before) ?? cookieBranch;
  const createdAt = new Date();
  const actorType = a.userId ? "USER" : "SYSTEM";
  const hash = chainHash(prevHash, { orgId: a.orgId, userId: a.userId, actorType, action: a.action, entity: a.entity, entityId: a.entityId, branchId, createdAt, before, after });
  await tx.auditLog.create({
    data: { orgId: a.orgId, userId: a.userId, actorType, action: a.action, entity: a.entity, entityId: a.entityId, before, after, ip, userAgent, branchId, createdAt, hash, prevHash },
  });
}

/**
 * Re-computes the hash chain of an organisation, in batches of 1,000. With `from`, only entries after `from.afterId`,
 * continuing from that entry's hash. Returns the last entry walked, so a later walk can continue from it.
 */
export async function verifyAuditChain(orgId: string, from?: { afterId: bigint; lastHash: string }) {
  let cursor: bigint | undefined = from?.afterId;
  let checked = 0;
  let bad = 0;
  let last = from?.lastHash ?? GENESIS;
  for (;;) {
    const rows = await db.auditLog.findMany({
      where: { orgId, ...(cursor !== undefined ? { id: { gt: cursor } } : {}) },
      orderBy: { id: "asc" },
      take: 1000,
      select: { id: true, orgId: true, userId: true, actorType: true, action: true, entity: true, entityId: true, branchId: true, before: true, after: true, createdAt: true, hash: true, prevHash: true },
    });
    if (!rows.length) break;
    // Carry the last hash across batches by feeding it as a virtual start.
    const r = verifyChainFrom(rows, last);
    checked += r.checked;
    bad += r.bad;
    last = r.lastHash;
    cursor = rows[rows.length - 1]!.id;
    if (rows.length < 1000) break;
  }
  return { checked, bad, lastId: cursor, lastHash: last };
}

type ChainStatus = { checked: number; bad: number; lastId?: bigint; lastHash: string; fullAt: number };
const ag = globalThis as unknown as { fitronAuditChain?: Map<string, ChainStatus>; fitronAuditWalks?: Map<string, Promise<ChainStatus>> };
/** The whole chain is walked again at most this often per gym; in between only new entries are checked. */
const FULL_WALK_MS = 6 * 3_600_000;

function fullWalk(orgId: string): Promise<ChainStatus> {
  const walks = (ag.fitronAuditWalks ??= new Map());
  const running = walks.get(orgId);
  if (running) return running;
  const p = verifyAuditChain(orgId)
    .then((r) => {
      const st: ChainStatus = { checked: r.checked, bad: r.bad, lastId: r.lastId, lastHash: r.lastHash, fullAt: Date.now() };
      (ag.fitronAuditChain ??= new Map()).set(orgId, st);
      return st;
    })
    .finally(() => walks.delete(orgId));
  walks.set(orgId, p);
  return p;
}

/**
 * The audit page's integrity figure without walking years of entries on every visit: the last whole walk (made in the
 * background, at most every six hours per gym) plus the entries added since, checked on from where it ended. Until the
 * first walk of a gym has finished, `checking` is true. A log replaced since the last walk (a restore), or any break
 * found in the new entries, starts a whole walk again before a break is reported.
 */
export async function auditChainStatus(orgId: string, now = Date.now()): Promise<{ checked: number; bad: number; checking: boolean }> {
  const known = ag.fitronAuditChain?.get(orgId);
  if (!known) {
    void fullWalk(orgId).catch(() => {});
    return { checked: 0, bad: 0, checking: true };
  }
  if (now - known.fullAt > FULL_WALK_MS) void fullWalk(orgId).catch(() => {});
  if (known.lastId !== undefined) {
    const still = await db.auditLog.findFirst({ where: { orgId, id: known.lastId }, select: { hash: true } });
    if (still?.hash !== known.lastHash) {
      void fullWalk(orgId).catch(() => {});
      return { checked: known.checked, bad: 0, checking: true };
    }
  }
  const more = await verifyAuditChain(orgId, known.lastId !== undefined ? { afterId: known.lastId, lastHash: known.lastHash } : undefined);
  if (more.bad && !known.bad) {
    const again = await fullWalk(orgId);
    return { checked: again.checked, bad: again.bad, checking: false };
  }
  return { checked: known.checked + more.checked, bad: known.bad + more.bad, checking: false };
}

function verifyChainFrom(rows: Parameters<typeof verifyChain>[0], start: string) {
  // verifyChain always starts at GENESIS; walk it by hand when continuing a chain.
  if (start === GENESIS) return verifyChain(rows);
  let checked = 0;
  let bad = 0;
  let lastHash = start;
  for (const r of rows) {
    if (r.hash == null) continue;
    checked++;
    if (r.prevHash !== lastHash || chainHash(lastHash, r) !== r.hash) bad++;
    lastHash = r.hash;
  }
  return { checked, bad, lastHash };
}
