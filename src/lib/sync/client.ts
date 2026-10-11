import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { log } from "@/lib/log";
import { sealSecret, unsealSecret } from "@/lib/services/two-step";
import { cloudCall, SyncHttpError } from "@/lib/integrations/sync";
import { keyFields, keyOf, SyncDataError, type WireRow } from "./codec";
import { SYNC_ENTITIES, SYNC_ENTITY } from "./entities";
import type { ConflictNote } from "./merge";
import { readRecord, writeRecord } from "./records";
import { PUSH_LIMIT, type ChangesPage, type PushItem, type PushResult, type SnapshotPage } from "./protocol";

// Cloud sync, the computer's side (docs/local-windows/SYNC.md §5). The desk never waits for it: every change is saved
// here first, recorded in the outbox by the database in the same transaction, and uploaded when fitron.in can be
// reached. A change is marked synced only after fitron.in confirmed it. Downloads are applied in one transaction per
// batch together with the checkpoint, so a batch that fails leaves the checkpoint where it was.

type Tx = Prisma.TransactionClient;

export type SyncState = NonNullable<Awaited<ReturnType<typeof readState>>>;

export const readState = () => db.syncState.findUnique({ where: { id: 1 } });

export async function isLinked(): Promise<boolean> {
  return !!(await db.syncState.findUnique({ where: { id: 1 }, select: { linked: true } }))?.linked;
}

export const sealToken = (token: string) => new Uint8Array(sealSecret(token));
export const tokenOf = (s: { token: Uint8Array | null }) => (s.token ? unsealSecret(s.token) : "");

/** Changes that came from fitron.in are written with this held, so the triggers do not record them as this computer's. */
async function fromCloud<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`INSERT OR REPLACE INTO "_fitron_sync_apply" ("id") VALUES (1)`;
      const r = await fn(tx);
      await tx.$executeRaw`DELETE FROM "_fitron_sync_apply"`;
      return r;
    },
    { timeout: 120_000, maxWait: 30_000 },
  );
}

const hasPending = async (tx: Tx | typeof db, entity: string, entityId: string, after?: bigint) =>
  !!(await tx.syncChange.findFirst({ where: { status: "PENDING", entity, entityId, ...(after !== undefined ? { seq: { gt: after } } : {}) }, select: { seq: true } }));

const setVersion = (tx: Tx, entity: string, entityId: string, version: number) =>
  tx.syncVersion.upsert({ where: { entity_entityId: { entity, entityId } }, create: { entity, entityId, version: BigInt(version) }, update: { version: BigInt(version) } });

async function saveConflict(tx: Tx, orgId: string, entity: string, entityId: string, c: ConflictNote, changeId = "") {
  await tx.syncConflict.create({
    data: { orgId, entity, entityId, kind: c.kind, ours: (c.ours ?? undefined) as Prisma.InputJsonValue | undefined, theirs: (c.theirs ?? undefined) as Prisma.InputJsonValue | undefined, fields: c.fields.join(","), changeId },
  });
}

type Conn = { base: string; token: string; state: SyncState };

// ── Upload ──────────────────────────────────────────────────────────────────────────────────────────────────────────

type Group = { entity: string; entityId: string; seqs: bigint[]; last: string; maxSeq: bigint };

/** The changes waiting to go up, one item per record (its newest state), oldest record first. */
async function pendingGroups(limit = PUSH_LIMIT): Promise<Group[]> {
  const rows = await db.syncChange.findMany({ where: { status: "PENDING" }, orderBy: { seq: "asc" }, take: limit * 20, select: { seq: true, changeId: true, entity: true, entityId: true } });
  const groups = new Map<string, Group>();
  for (const r of rows) {
    const k = `${r.entity}\u0000${r.entityId}`;
    const g = groups.get(k);
    if (g) {
      g.seqs.push(r.seq);
      g.last = r.changeId;
      g.maxSeq = r.seq;
    } else if (groups.size < limit) groups.set(k, { entity: r.entity, entityId: r.entityId, seqs: [r.seq], last: r.changeId, maxSeq: r.seq });
  }
  return [...groups.values()];
}

/** Uploads one batch. Returns how many records went up (0: nothing was waiting). */
export async function pushPending(c: Conn): Promise<number> {
  const groups = await pendingGroups();
  if (!groups.length) return 0;
  const items: PushItem[] = [];
  for (const g of groups) {
    const data = SYNC_ENTITY.has(g.entity) ? await readRecord(db, g.entity, g.entityId) : null;
    const v = await db.syncVersion.findUnique({ where: { entity_entityId: { entity: g.entity, entityId: g.entityId } } });
    items.push({ changeId: g.last, entity: g.entity, entityId: g.entityId, op: data ? "upsert" : "delete", data, baseVersion: Number(v?.version ?? 0) });
  }
  const { results } = await cloudCall<{ results: PushResult[] }>(c.base, "/api/sync/push", { method: "POST", token: c.token, body: { items }, timeoutMs: 120_000 });
  const byId = new Map(results.map((r) => [r.changeId, r]));
  await fromCloud(async (tx) => {
    for (const g of groups) {
      const r = byId.get(g.last);
      if (!r) continue;
      const mine = { status: "PENDING", seq: { in: g.seqs } };
      if (r.status === "rejected") {
        await tx.syncChange.updateMany({ where: mine, data: { status: "REJECTED", error: r.reason ?? "Refused by fitron.in.", attempts: { increment: 1 } } });
        continue;
      }
      await tx.syncChange.updateMany({ where: mine, data: { status: r.status === "applied" ? "DONE" : "CONFLICT", error: r.status === "conflict" ? conflictWords(r.conflict) : null } });
      if (r.version) await setVersion(tx, g.entity, g.entityId, r.version);
      // fitron.in's record, when it is not exactly what went up (merged, or the website's kept): stored here too,
      // unless the desk changed the record again meanwhile (that change goes up next, from this version).
      if (r.current !== undefined && !(await hasPending(tx, g.entity, g.entityId, g.maxSeq))) await writeRecord(tx, g.entity, g.entityId, r.current);
      if (r.conflict) await saveConflict(tx, c.state.orgId, g.entity, g.entityId, r.conflict, g.last);
    }
    await tx.syncState.update({ where: { id: 1 }, data: { lastPushAt: new Date() } });
  });
  return groups.length;
}

export function conflictWords(c?: ConflictNote): string {
  if (!c) return "";
  if (c.kind === "kept-website") return "The website changed this record too; its version was kept. Your change is kept under Conflicts.";
  if (c.kind === "deleted") return c.ours ? "This record was deleted on the website; your change is kept under Conflicts." : "You deleted this record while the website changed it; the delete stands, the website's version is kept under Conflicts.";
  return `Both changed ${c.fields.join(", ")}; this computer's change was applied, the website's is kept under Conflicts.`;
}

// ── Download ────────────────────────────────────────────────────────────────────────────────────────────────────────

const isDataError = (e: unknown) => e instanceof SyncDataError || (!!e && typeof e === "object" && ["P2002", "P2003", "P2025"].includes((e as { code?: string }).code ?? "")) || (e as { code?: string })?.code === "FITRON_GUARD";

async function applyPulled(tx: Tx, ch: ChangesPage["changes"][number]) {
  // A record changed here and not yet uploaded is left as it is: the upload goes first, from the version this
  // computer started from, and fitron.in decides (SYNC.md §6); its answer, and the next download, bring the result.
  if (await hasPending(tx, ch.entity, ch.entityId)) return;
  await writeRecord(tx, ch.entity, ch.entityId, ch.op === "delete" ? null : ch.data);
  await setVersion(tx, ch.entity, ch.entityId, ch.seq);
}

/** Downloads and applies every change since the checkpoint. Returns how many were applied. */
export async function pullAll(c: Conn): Promise<number> {
  let since = Number(c.state.pulledSeq);
  let total = 0;
  for (let round = 0; round < 1000; round++) {
    const page = await cloudCall<ChangesPage>(c.base, `/api/sync/changes?since=${since}`, { token: c.token });
    if (page.resync) {
      await db.syncState.update({ where: { id: 1 }, data: { needsSnapshot: true } });
      return total;
    }
    if (page.changes.length) {
      try {
        await fromCloud(async (tx) => {
          for (const ch of page.changes) await applyPulled(tx, ch);
          await tx.syncState.update({ where: { id: 1 }, data: { pulledSeq: BigInt(page.next), appliedSeq: BigInt(page.next), lastPullAt: new Date() } });
        });
      } catch (e) {
        if (!isDataError(e)) throw e;
        // One change this database cannot take (a rule here, a missing parent): apply the batch one change at a time,
        // keep the ones that fail for the owner under Conflicts, and carry on. Nothing is skipped silently.
        for (const ch of page.changes) {
          try {
            await fromCloud(async (tx) => {
              await applyPulled(tx, ch);
              await tx.syncState.update({ where: { id: 1 }, data: { pulledSeq: BigInt(ch.seq), appliedSeq: BigInt(ch.seq), lastPullAt: new Date() } });
            });
          } catch (err) {
            if (!isDataError(err)) throw err;
            log.warn("sync.pull.not_applied", err, { entity: ch.entity, entityId: ch.entityId, seq: ch.seq });
            await fromCloud(async (tx) => {
              await tx.syncConflict.create({ data: { orgId: c.state.orgId, entity: ch.entity, entityId: ch.entityId, kind: "not-applied", theirs: (ch.data ?? undefined) as Prisma.InputJsonValue | undefined, fields: (err as Error).message.slice(0, 300) } });
              await tx.syncState.update({ where: { id: 1 }, data: { pulledSeq: BigInt(ch.seq), lastPullAt: new Date() } });
            });
          }
        }
      }
      total += page.changes.length;
    } else if (page.next !== since) {
      await db.syncState.update({ where: { id: 1 }, data: { pulledSeq: BigInt(page.next), lastPullAt: new Date() } });
    } else {
      await db.syncState.update({ where: { id: 1 }, data: { lastPullAt: new Date() } });
    }
    since = page.next;
    if (!page.more) return total;
  }
  return total;
}

// ── Whole-gym download (linking, and after a restore on either side) ──────────────────────────────────────────────────

/**
 * Every synced record of the gym, table by table, written through `client` (the live database, or a new one being
 * built for linking). Returns the gym's change number before the first page was read: downloading changes from there on
 * brings whatever changed while the pages were read.
 */
export async function downloadGym(o: { base: string; token: string; client: typeof db; orgId: string; removeMissing: boolean; onTable?: (entity: string, n: number) => void }): Promise<number> {
  let start: number | null = null;
  for (const e of SYNC_ENTITIES) {
    const seen = new Set<string>();
    let after: string | null = null;
    do {
      const page: SnapshotPage = await cloudCall<SnapshotPage>(o.base, `/api/sync/snapshot?entity=${e.name}${after ? `&after=${encodeURIComponent(after)}` : ""}`, { token: o.token, timeoutMs: 120_000 });
      start ??= page.seq;
      await o.client.$transaction(
        async (tx) => {
          await tx.$executeRaw`INSERT OR REPLACE INTO "_fitron_sync_apply" ("id") VALUES (1)`;
          for (const r of page.rows) {
            const id = keyOf(e.name, r.data);
            seen.add(id);
            if (await hasPending(tx, e.name, id)) continue;
            await writeRecord(tx, e.name, id, r.data);
            await setVersion(tx, e.name, id, r.version);
          }
          await tx.$executeRaw`DELETE FROM "_fitron_sync_apply"`;
        },
        { timeout: 120_000, maxWait: 30_000 },
      );
      o.onTable?.(e.name, page.rows.length);
      after = page.last;
    } while (after);
    if (o.removeMissing) await removeMissing(o.client, o.orgId, e.name, seen);
  }
  return start ?? 0;
}

/** After a whole-gym download: records here that fitron.in no longer has. Removable ones go; money is kept and listed. */
async function removeMissing(client: typeof db, orgId: string, entity: string, seen: Set<string>) {
  const spec = SYNC_ENTITY.get(entity)!;
  const rows = (await (client as unknown as Record<string, { findMany(a: unknown): Promise<WireRow[]> }>)[entity[0]!.toLowerCase() + entity.slice(1)]!.findMany({ where: spec.orgWhere(orgId) })) as WireRow[];
  for (const row of rows) {
    const id = keyOf(entity, row);
    if (seen.has(id) || (await hasPending(client, entity, id))) continue;
    if (entity === "Setting" && spec.skipKeys?.includes(String(row.key))) continue;
    await client.$transaction(async (tx) => {
      await tx.$executeRaw`INSERT OR REPLACE INTO "_fitron_sync_apply" ("id") VALUES (1)`;
      if (spec.deletable) await writeRecord(tx, entity, id, null);
      else await tx.syncConflict.create({ data: { orgId, entity, entityId: id, kind: "only-here", fields: "" } });
      await tx.$executeRaw`DELETE FROM "_fitron_sync_apply"`;
    });
  }
}

/** Downloads the whole gym again into the live database (after a restore on either side), then carries on incrementally. */
export async function resync(c: Conn): Promise<void> {
  const started = new Date();
  const start = await downloadGym({ base: c.base, token: c.token, client: db, orgId: c.state.orgId, removeMissing: true });
  await db.syncState.update({ where: { id: 1 }, data: { pulledSeq: BigInt(start), appliedSeq: BigInt(start), needsSnapshot: false, lastPullAt: new Date() } });
  // Tells fitron.in this computer has the gym as it was when the download started.
  await cloudCall<ChangesPage>(c.base, `/api/sync/changes?since=${start}&limit=1&resynced=${encodeURIComponent(started.toISOString())}`, { token: c.token });
  c.state.pulledSeq = BigInt(start);
}

// ── One round ───────────────────────────────────────────────────────────────────────────────────────────────────────

export type RoundResult = { pushed: number; pulled: number; resynced: boolean };

/** Upload what waits, then download what is new. Throws SyncHttpError when fitron.in cannot be reached or refuses. */
export async function syncOnce(base: string): Promise<RoundResult | null> {
  const state = await readState();
  if (!state?.linked) return null;
  const c: Conn = { base, token: tokenOf(state), state };
  if (!c.token) throw new SyncHttpError(401, "This computer has no device token. Link it again in Settings › Cloud sync.", "unlinked");
  const out: RoundResult = { pushed: 0, pulled: 0, resynced: false };
  try {
    for (let i = 0; i < 1000; i++) {
      const n = await pushPending(c);
      out.pushed += n;
      if (!n) break;
    }
    if (state.needsSnapshot) {
      await resync(c);
      out.resynced = true;
    }
    out.pulled = await pullAll(c);
    const after = await readState();
    if (after?.needsSnapshot) {
      c.state = after;
      await resync(c);
      out.resynced = true;
      out.pulled += await pullAll(c);
    }
    await db.syncState.update({ where: { id: 1 }, data: { lastOkAt: new Date(), lastError: null, failures: 0 } });
    return out;
  } catch (e) {
    const message = e instanceof SyncHttpError ? e.message : e instanceof Error ? e.message : String(e);
    await db.syncState.update({ where: { id: 1 }, data: { lastError: message.slice(0, 500), failures: { increment: 1 } } }).catch(() => {});
    throw e;
  }
}

// ── For the screen ──────────────────────────────────────────────────────────────────────────────────────────────────

export async function syncCounts() {
  const [pending, failed, conflicts, kept] = await Promise.all([
    db.syncChange.count({ where: { status: "PENDING" } }),
    db.syncChange.count({ where: { status: "REJECTED" } }),
    db.syncConflict.count({ where: { resolvedAt: null } }),
    db.syncChange.count({ where: { status: "CONFLICT" } }),
  ]);
  return { pending, failed, conflicts, kept };
}

/** The changes fitron.in refused, newest first, one per record, with the reason. */
export async function failedChanges(take = 50) {
  const rows = await db.syncChange.findMany({ where: { status: "REJECTED" }, orderBy: { seq: "desc" }, take: take * 5 });
  const seen = new Set<string>();
  return rows.filter((r) => (seen.has(`${r.entity}|${r.entityId}`) ? false : seen.add(`${r.entity}|${r.entityId}`))).slice(0, take);
}

/** Sends refused changes again (as new changes, so fitron.in looks at them afresh), e.g. after fixing the cause. */
export async function retryFailed(ids?: bigint[]) {
  const rows = await db.syncChange.findMany({ where: { status: "REJECTED", ...(ids ? { seq: { in: ids } } : {}) } });
  await db.$transaction(async (tx) => {
    for (const r of rows) {
      await tx.syncChange.update({ where: { seq: r.seq }, data: { status: "DONE", error: `${r.error ?? ""} (sent again)`.trim() } });
      await tx.syncChange.create({ data: { changeId: crypto.randomUUID().replace(/-/g, ""), orgId: r.orgId, entity: r.entity, entityId: r.entityId, op: r.op, origin: "local", status: "PENDING" } });
    }
  });
  return rows.length;
}

/** Leaves refused changes as they are: the record stays on this computer only. */
export async function dismissFailed(ids?: bigint[]) {
  const r = await db.syncChange.updateMany({ where: { status: "REJECTED", ...(ids ? { seq: { in: ids } } : {}) }, data: { status: "DONE", error: "Kept on this computer only (dismissed)." } });
  return r.count;
}

export { keyFields };
