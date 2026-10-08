import "server-only";
import { cookies, headers } from "next/headers";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { BRANCH_COOKIE } from "@/lib/auth/current";
import { GENESIS, chainHash, verifyChain } from "@/lib/domain/audit-chain";

type Tx = Prisma.TransactionClient;

const json = (v: unknown) => (v === undefined ? undefined : (JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue));

/** Rule 10: every write to core tables leaves an audit row in the same transaction, chained by hash onto the organisation's previous entry. */
export async function audit(
  tx: Tx,
  a: { orgId: string; userId: string | null; action: string; entity: string; entityId: string; before?: unknown; after?: unknown; branchId?: string | null },
) {
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
  // Serialise writers per organisation so two transactions cannot chain onto the same previous hash.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${a.orgId}))`;
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

/** Re-computes the hash chain of an organisation. O(n) per call (read in batches of 1,000); fine for now, cache or checkpoint later. */
export async function verifyAuditChain(orgId: string) {
  let cursor: bigint | undefined;
  let checked = 0;
  let bad = 0;
  let last = GENESIS;
  for (;;) {
    const rows = await db.auditLog.findMany({
      where: { orgId },
      orderBy: { id: "asc" },
      take: 1000,
      ...(cursor !== undefined ? { cursor: { id: cursor }, skip: 1 } : {}),
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
  return { checked, bad };
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
