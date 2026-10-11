import "server-only";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { clearFailures, lockedMinutes, recordFailure } from "@/lib/auth/lockout";
import { verifySecondFactor } from "@/lib/services/two-step";
import { audit } from "@/lib/services/audit";
import { UserError } from "@/lib/services/errors";
import { log } from "@/lib/log";
import { TRIAL_DAYS } from "@/lib/domain/pricing";
import { ensureExpenseCategories, ensureRoles } from "../../../prisma/roles";
import { changedFields, keyFields, keyOf, SyncDataError, toWire, type WireRow } from "./codec";
import { SYNC_ENTITIES, SYNC_ENTITY, type SyncEntity } from "./entities";
import { decide, type ConflictNote } from "./merge";
import { readPage, readRecord, writeRecord } from "./records";
import { PULL_LIMIT, PUSH_LIMIT, SNAPSHOT_LIMIT, type ChangesPage, type GymCheck, type LinkedGym, type PulledChange, type PushItem, type PushResult, type SnapshotPage } from "./protocol";

// Cloud sync, the fitron.in side (docs/local-windows/SYNC.md §2, §5–7). Computers never write to the database: they send
// changes here, and each is checked (the gym, the record's fields and types, the rules for money, the version it was
// made from) and stored by this server in a transaction of its own, with its change id recorded in the same
// transaction so a retry is answered from the record, never applied twice. "Synced" is only ever reported after that
// transaction has committed.

type Tx = Prisma.TransactionClient;

export type DeviceAuth = { id: string; orgId: string; name: string; deviceNo: number; linkedById: string; pulledSeq: bigint; resyncAt: Date | null };

export class SyncRejection extends Error {
  constructor(
    message: string,
    /** Written to the gym's audit log after the refused change's transaction has rolled back. */
    readonly auditEntry?: Parameters<typeof audit>[1],
  ) {
    super(message);
    this.name = "SyncRejection";
  }
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const newToken = () => `fsd_${randomBytes(32).toString("base64url")}`;

/** The computer behind a device token, or null (unknown, revoked, or its owner can no longer link computers). */
export async function authDevice(header: string | null): Promise<DeviceAuth | null> {
  const token = /^Bearer (fsd_[A-Za-z0-9_-]{43})$/.exec(header ?? "")?.[1];
  if (!token) return null;
  const dev = await db.syncDevice.findUnique({ where: { tokenHash: sha256(token) } });
  if (!dev || dev.revokedAt) return null;
  // The person who linked it must still be an active Super Admin of the gym: a computer never has more rights than they do.
  const owner = await db.user.findFirst({ where: { id: dev.linkedById, orgId: dev.orgId, active: true, deletedAt: null, role: { name: "Super Admin" } }, select: { id: true } });
  if (!owner) return null;
  if (!dev.lastSeenAt || Date.now() - dev.lastSeenAt.getTime() > 60_000) await db.syncDevice.update({ where: { id: dev.id }, data: { lastSeenAt: new Date() } });
  return { id: dev.id, orgId: dev.orgId, name: dev.name, deviceNo: dev.deviceNo, linkedById: dev.linkedById, pulledSeq: dev.pulledSeq, resyncAt: dev.resyncAt };
}

export async function latestSeq(orgId: string, c: Tx | typeof db = db): Promise<number> {
  const r = await c.syncChange.aggregate({ where: { orgId }, _max: { seq: true } });
  return Number(r._max.seq ?? 0);
}

// ── Linking ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export type Credentials = { email: string; password: string; code?: string };

let dummyHash: Promise<string> | undefined;

/** The gym owner, checked as the sign-in page checks (lockout, password, two-step code), who must be a Super Admin. */
async function owner(c: Credentials) {
  const email = c.email.trim().toLowerCase();
  const locked = lockedMinutes(email);
  if (locked) throw new UserError(`Too many wrong passwords for this account. Try again in ${locked} ${locked === 1 ? "minute" : "minutes"}.`);
  const user = await db.user.findFirst({ where: { email, active: true, deletedAt: null }, include: { role: true, org: { select: { id: true, name: true } } } });
  const ok = await verifyPassword(user?.passwordHash ?? (await (dummyHash ??= hashPassword("not-a-real-password"))), c.password);
  if (!user || !ok) {
    recordFailure(email);
    throw new UserError("Email or password is incorrect.");
  }
  clearFailures(email);
  if (!user.emailVerifiedAt) throw new UserError("Confirm this account's email on fitron.in first (open the link we sent), then link this computer.");
  if (user.totpEnabledAt) {
    if (!c.code?.trim()) throw new UserError("Enter the 6-digit code from your authenticator app.", "two-step");
    if (!(await verifySecondFactor(user.id, c.code.trim()))) throw new UserError("That code is not right. Try the newest one.", "two-step");
  }
  if (user.role.name !== "Super Admin") throw new UserError("Only a Super Admin of the gym can link a computer to it.");
  return user;
}

const counts = async (orgId: string) => {
  const [members, invoices, payments] = await Promise.all([db.member.count({ where: { orgId, walkIn: false } }), db.invoice.count({ where: { orgId } }), db.payment.count({ where: { orgId } })]);
  return { members, invoices, payments };
};

/** Step one of linking: who the gym is, and what it holds, before anything is changed. */
export async function checkGym(c: Credentials): Promise<GymCheck> {
  const user = await owner(c);
  return { org: user.org, counts: await counts(user.orgId), devices: await db.syncDevice.count({ where: { orgId: user.orgId, revokedAt: null } }) };
}

async function nextDeviceNo(tx: Tx, orgId: string) {
  const top = await tx.syncDevice.aggregate({ where: { orgId }, _max: { deviceNo: true } });
  return (top._max.deviceNo ?? 0) + 1;
}

/** Links a computer to the owner's gym on fitron.in. The token is returned once; only its hash is kept. */
export async function linkDevice(c: Credentials, d: { name: string; installationId?: string }): Promise<LinkedGym> {
  const user = await owner(c);
  const token = newToken();
  const device = await db.$transaction(async (tx) => {
    const dev = await tx.syncDevice.create({
      data: { orgId: user.orgId, name: d.name.slice(0, 80) || "FITRON for Windows", deviceNo: await nextDeviceNo(tx, user.orgId), tokenHash: sha256(token), linkedById: user.id, installationId: d.installationId?.slice(0, 64) },
    });
    await audit(tx, { orgId: user.orgId, userId: user.id, action: "sync.link", entity: "SyncDevice", entityId: dev.id, after: { name: dev.name, deviceNo: dev.deviceNo } });
    return dev;
  });
  return { token, device: { id: device.id, no: device.deviceNo, name: device.name }, org: user.org, user: { id: user.id, name: user.name, email: user.email, phone: user.phone }, seq: await latestSeq(user.orgId) };
}

export type Registration = {
  email: string;
  password: string;
  name: string;
  phone: string;
  gymName: string;
  /** The computer's own ids, kept, so both sides name every record the same way */
  orgId: string;
  ownerId: string;
  deviceName: string;
  installationId?: string;
  /** The computer's number sequences, so the website carries on after the numbers it already used */
  sequences: { name: string; next: number }[];
};

/**
 * Puts a gym that was set up on a computer onto fitron.in: a new fitron.in account with the computer's ids, owned by the
 * person on the computer (a new fitron.in password, the email to be confirmed as for any sign-up). The computer then
 * uploads its records through the ordinary upload. Refused when the email or the ids are already in use.
 */
export async function registerGym(r: Registration, sendVerification: (userId: string) => Promise<void>, emailOn: boolean): Promise<LinkedGym> {
  const email = r.email.trim().toLowerCase();
  if (await db.user.findUnique({ where: { email } })) throw new UserError("There's already a fitron.in account with this email. Link this computer to that gym instead, or use another email.");
  if (await db.organization.findUnique({ where: { id: r.orgId } })) throw new UserError("This gym is already on fitron.in. Link this computer to it instead.");
  if (await db.user.findUnique({ where: { id: r.ownerId } })) throw new UserError("This gym's owner is already on fitron.in. Link this computer instead.");
  const roles = await ensureRoles(db);
  await ensureExpenseCategories(db);
  const passwordHash = await hashPassword(r.password);
  const token = newToken();
  const deviceId = `dev_${randomUUID().replace(/-/g, "")}`;
  const user = await db.$transaction(async (tx) => {
    // Everything here is the computer's: recorded as its changes, so its own upload of the same records is no conflict.
    await tx.$executeRaw`SELECT set_config('fitron.sync_origin', ${`device:${deviceId}`}, true)`;
    await tx.organization.create({ data: { id: r.orgId, name: r.gymName.slice(0, 120), plan: "professional", planCycle: "MONTHLY", trialEndsAt: new Date(Date.now() + TRIAL_DAYS * 86_400_000) } });
    const owner = await tx.user.create({ data: { id: r.ownerId, orgId: r.orgId, name: r.name, email, phone: r.phone, roleId: roles.get("Super Admin")!, passwordHash, emailVerifiedAt: emailOn ? null : new Date() } });
    for (const s of r.sequences) if (/^[A-Za-z]{1,40}$/.test(s.name) && Number.isSafeInteger(s.next) && s.next > 0) await tx.sequence.create({ data: { orgId: r.orgId, name: s.name, next: s.next } });
    await tx.syncDevice.create({ data: { id: deviceId, orgId: r.orgId, name: r.deviceName.slice(0, 80) || "FITRON for Windows", deviceNo: 1, tokenHash: sha256(token), linkedById: owner.id, installationId: r.installationId?.slice(0, 64) } });
    await audit(tx, { orgId: r.orgId, userId: owner.id, action: "sync.register", entity: "Organization", entityId: r.orgId, after: { from: "FITRON for Windows", device: r.deviceName } });
    return owner;
  });
  if (emailOn) await sendVerification(user.id).catch((e) => log.error("sync.register.verification_failed", e));
  return { token, device: { id: deviceId, no: 1, name: r.deviceName }, org: { id: r.orgId, name: r.gymName }, user: { id: user.id, name: user.name, email: user.email, phone: user.phone }, seq: await latestSeq(r.orgId) };
}

/** Stops a computer: its token is refused from its next request. */
export async function revokeDevice(orgId: string, userId: string, deviceId: string) {
  await db.$transaction(async (tx) => {
    const dev = await tx.syncDevice.findFirst({ where: { id: deviceId, orgId, revokedAt: null } });
    if (!dev) throw new UserError("That computer is not linked.");
    await tx.syncDevice.update({ where: { id: dev.id }, data: { revokedAt: new Date() } });
    await audit(tx, { orgId, userId, action: "sync.unlink", entity: "SyncDevice", entityId: dev.id, before: { name: dev.name } });
  });
}

/**
 * After a gym's records were replaced wholesale here (a restore, or Clear demo data), every linked computer downloads the
 * gym again: the change log does not describe such a replacement row by row.
 */
export async function requireResync(tx: Tx, orgId: string) {
  await tx.syncDevice.updateMany({ where: { orgId, revokedAt: null }, data: { resyncAt: new Date() } });
}

// ── Download: changes and snapshot ────────────────────────────────────────────────────────────────────────────────

async function roleNames(c: Tx | typeof db) {
  return new Map((await c.role.findMany({ select: { id: true, name: true } })).map((r) => [r.id, r.name]));
}

/** A change's stored data (PostgreSQL's to_jsonb of the row) on the wire. */
function storedToWire(entity: string, data: unknown, roles: Map<string, string>): WireRow | null {
  if (!data || typeof data !== "object") return null;
  const wire = toWire(entity, data as Record<string, unknown>);
  if (entity === "User") {
    wire.$role = roles.get(String((data as Record<string, unknown>).roleId)) ?? null;
    delete wire.roleId;
  }
  return wire;
}

export async function changesSince(dev: DeviceAuth, since: number, limit = PULL_LIMIT, resyncedAt?: Date): Promise<ChangesPage> {
  const take = Math.min(Math.max(1, limit), PULL_LIMIT);
  if (resyncedAt && dev.resyncAt && dev.resyncAt <= resyncedAt) {
    await db.syncDevice.update({ where: { id: dev.id }, data: { resyncAt: null } });
    dev.resyncAt = null;
  }
  const [rows, latest, roles] = await Promise.all([
    db.syncChange.findMany({ where: { orgId: dev.orgId, seq: { gt: BigInt(Math.max(0, since)) } }, orderBy: { seq: "asc" }, take }),
    latestSeq(dev.orgId),
    roleNames(db),
  ]);
  // Asking from `since` confirms the computer has everything up to it (the outbox is trimmed only below every computer).
  if (BigInt(since) > dev.pulledSeq) await db.syncDevice.update({ where: { id: dev.id }, data: { pulledSeq: BigInt(since) } });
  const changes: PulledChange[] = rows.map((r) => ({ seq: Number(r.seq), entity: r.entity, entityId: r.entityId, op: r.op as "upsert" | "delete", data: r.op === "delete" ? null : storedToWire(r.entity, r.data, roles), origin: r.origin }));
  return { changes, next: changes.length ? changes[changes.length - 1]!.seq : since, latest, more: rows.length === take, resync: !!dev.resyncAt };
}

/** One page of the whole gym, table by table, with each record's version. `seq`: the gym's newest change when read. */
export async function snapshotPage(dev: DeviceAuth, entity: string, after: string | null, limit = SNAPSHOT_LIMIT): Promise<SnapshotPage> {
  if (!SYNC_ENTITY.has(entity)) throw new UserError(`${entity} is not synced.`);
  const seq = await latestSeq(dev.orgId);
  const page = await db.$transaction((tx) => readPage(tx, entity, dev.orgId, after, Math.min(Math.max(1, limit), SNAPSHOT_LIMIT)));
  const ids = page.rows.map((r) => keyOf(entity, r));
  const versions = ids.length
    ? await db.syncChange.groupBy({ by: ["entityId"], where: { orgId: dev.orgId, entity, entityId: { in: ids } }, _max: { seq: true } })
    : [];
  const v = new Map(versions.map((x) => [x.entityId, Number(x._max.seq ?? 0)]));
  return { entity, rows: page.rows.map((data) => ({ data, version: v.get(keyOf(entity, data)) ?? 0 })), last: page.last, seq };
}

// ── Upload ──────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The gym a wire row belongs to. */
async function orgOfRow(tx: Tx, spec: SyncEntity, row: WireRow): Promise<string | null> {
  if (!spec.parent) return typeof row.orgId === "string" ? row.orgId : null;
  const [table, field] = spec.parent;
  const parentId = row[field];
  if (typeof parentId !== "string") return null;
  const p = await (tx as unknown as Record<string, { findUnique(a: unknown): Promise<{ orgId: string } | null> }>)[table[0]!.toLowerCase() + table.slice(1)]!.findUnique({ where: { id: parentId }, select: { orgId: true } });
  return p?.orgId ?? null;
}

const DATED_MONEY = new Set(["Invoice", "Payment", "Expense"]);

/** The rules every stored record keeps, whoever sent it (SYNC.md §6): money records change only the way the app changes them. */
async function checkWrite(tx: Tx, spec: SyncEntity, current: WireRow | null, next: WireRow) {
  const label = spec.name.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  if (current && (spec.kind === "server" || spec.kind === "append")) {
    const changed = changedFields(spec.name, current, next).filter((f) => !(spec.mutable ?? []).includes(f));
    if (changed.length) throw new SyncRejection(`A recorded ${label} cannot be changed this way (${changed.join(", ")}). Cancel, reverse or void it in FITRON instead.`);
  }
  if (!current && DATED_MONEY.has(spec.name) && typeof next.date === "string" && typeof next.branchId === "string") {
    const month = next.date.slice(0, 7);
    if (await tx.monthLock.findUnique({ where: { branchId_month: { branchId: next.branchId, month } } })) throw new SyncRejection(`${month} is closed on fitron.in, so this ${label} was not added. Reopen the month there, or enter it in an open month.`);
  }
  if (spec.name === "Payment" && !current && next.status === "SUCCESS") {
    const inv = await tx.invoice.findUnique({ where: { id: String(next.invoiceId) }, select: { orgId: true, total: true, status: true, number: true } });
    if (!inv) throw new SyncRejection("The invoice of this payment is not on fitron.in.");
    if (inv.status === "CANCELLED") throw new SyncRejection(`Invoice ${inv.number} is cancelled on fitron.in, so this payment was not added.`);
    const paid = (await tx.payment.aggregate({ where: { invoiceId: String(next.invoiceId), status: "SUCCESS" }, _sum: { amount: true } }))._sum.amount ?? 0;
    const amount = Number(next.amount);
    if (!(amount > 0)) throw new SyncRejection("A payment must be more than zero.");
    if (paid + amount > inv.total) throw new SyncRejection(`This payment would take invoice ${inv.number} past its total: ₹${((inv.total - paid) / 100).toFixed(2)} was still due on fitron.in. It may have been collected there already.`);
  }
}

const isPrismaCode = (e: unknown, ...codes: string[]) => !!e && typeof e === "object" && codes.includes((e as { code?: string }).code ?? "");

/** Words for the owner when the database itself refuses a change, or null when the failure is not about the change. */
function refusal(e: unknown): string | null {
  if (e instanceof SyncRejection || e instanceof SyncDataError || e instanceof UserError) return e.message;
  if (isPrismaCode(e, "P2002")) return "Another record on fitron.in already uses this number, phone or email.";
  if (isPrismaCode(e, "P2003", "P2025")) return "A record this one depends on is not on fitron.in (it may have been refused).";
  if (e instanceof Error && /financial records are kept|append-only/.test(e.message)) return e.message;
  return null;
}

async function applyOne(tx: Tx, dev: DeviceAuth, item: PushItem): Promise<{ result: PushResult; conflict?: ConflictNote }> {
  const spec = SYNC_ENTITY.get(item.entity);
  if (!spec) throw new SyncRejection(`${item.entity} is not synced.`);
  if (item.op !== "upsert" && item.op !== "delete") throw new SyncRejection("Unknown change.");
  keyFields(item.entity, item.entityId);
  const incoming = item.op === "delete" ? null : item.data;
  if (incoming && (typeof incoming !== "object" || keyOf(item.entity, incoming) !== item.entityId)) throw new SyncRejection("The record does not match its key.");
  if (spec.skipKeys && spec.skipKeys.includes(item.entityId.split("|")[1] ?? "")) throw new SyncRejection("This setting belongs to one computer and is not synced.");

  const current = await readRecord(tx, item.entity, item.entityId);
  // The gym: of the record as it is here, and as it would be. A computer only ever touches its own gym's records.
  const foreign = (current && (await orgOfRow(tx, spec, current)) !== dev.orgId) || (incoming && (await orgOfRow(tx, spec, incoming)) !== dev.orgId);
  if (foreign) throw new SyncRejection("This record does not belong to this gym.", { orgId: dev.orgId, userId: dev.linkedById, action: "sync.refused_foreign", entity: item.entity, entityId: item.entityId, after: { device: dev.name } });

  const where = { orgId: dev.orgId, entity: item.entity, entityId: item.entityId };
  const base = Math.max(0, Math.floor(item.baseVersion || 0));
  const contested = !!(await tx.syncChange.findFirst({ where: { ...where, seq: { gt: BigInt(base) }, origin: { not: `device:${dev.id}` } }, select: { seq: true } }));
  let baseRow: WireRow | null = null;
  let baseKnown = base === 0 && !current;
  if (contested && base > 0) {
    const b = await tx.syncChange.findFirst({ where: { ...where, seq: BigInt(base) }, select: { data: true, op: true } });
    if (b) {
      baseKnown = true;
      baseRow = b.op === "delete" ? null : storedToWire(item.entity, b.data, await roleNames(tx));
    }
  }
  const d = decide({ entity: item.entity, base: baseRow, baseKnown, current, incoming, contested });
  const version = async () => Number((await tx.syncChange.aggregate({ where, _max: { seq: true } }))._max.seq ?? 0);
  if (d.action === "keep") return { result: { changeId: item.changeId, status: "conflict", version: await version(), current, conflict: d.conflict }, conflict: d.conflict };
  if (!d.data) {
    if (current && !spec.deletable) throw new SyncRejection(`A ${spec.name} is never deleted; cancel, reverse or void it instead.`);
    if (current) await writeRecord(tx, item.entity, item.entityId, null);
  } else {
    await checkWrite(tx, spec, current, d.data);
    await writeRecord(tx, item.entity, item.entityId, d.data);
  }
  const merged = d.data && incoming && changedFields(item.entity, d.data, incoming).length ? d.data : undefined;
  return { result: { changeId: item.changeId, status: "applied", version: await version(), ...(merged ? { current: merged } : {}), ...(d.conflict ? { conflict: d.conflict } : {}) }, conflict: d.conflict };
}

async function keepConflict(tx: Tx, dev: DeviceAuth, item: PushItem, c: ConflictNote) {
  await tx.syncConflict.create({
    data: { orgId: dev.orgId, entity: item.entity, entityId: item.entityId, kind: c.kind, ours: (c.ours ?? undefined) as Prisma.InputJsonValue | undefined, theirs: (c.theirs ?? undefined) as Prisma.InputJsonValue | undefined, fields: c.fields.join(","), deviceId: dev.id, changeId: item.changeId },
  });
}

/** One upload, in a transaction of its own: applied and recorded together, or neither. */
export async function pushOne(dev: DeviceAuth, item: PushItem): Promise<PushResult> {
  if (typeof item?.changeId !== "string" || !/^[0-9a-f-]{16,40}$/i.test(item.changeId)) return { changeId: String(item?.changeId ?? ""), status: "rejected", reason: "Bad change id." };
  const seen = await db.syncApplied.findUnique({ where: { changeId: item.changeId } });
  if (seen) return seen.deviceId === dev.id ? { ...(seen.result as unknown as PushResult), replayed: true } : { changeId: item.changeId, status: "rejected", reason: "Bad change id." };
  try {
    return await db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT set_config('fitron.sync_origin', ${`device:${dev.id}`}, true)`;
        const { result, conflict } = await applyOne(tx, dev, item);
        if (conflict) await keepConflict(tx, dev, item, conflict);
        await tx.syncApplied.create({ data: { changeId: item.changeId, orgId: dev.orgId, deviceId: dev.id, result: result as unknown as Prisma.InputJsonValue } });
        return result;
      },
      { timeout: 30_000, maxWait: 15_000 },
    );
  } catch (e) {
    const reason = refusal(e);
    if (!reason) throw e;
    const result: PushResult = { changeId: item.changeId, status: "rejected", reason };
    // Remembered, so a retry of the same change gets the same answer; the owner's Retry sends it as a new change.
    await db.syncApplied.create({ data: { changeId: item.changeId, orgId: dev.orgId, deviceId: dev.id, result: result as unknown as Prisma.InputJsonValue } }).catch(() => {});
    if (e instanceof SyncRejection && e.auditEntry) await db.$transaction((tx) => audit(tx, e.auditEntry!));
    return result;
  }
}

/** A batch of uploads, applied in order, with one audit entry for the batch. */
export async function pushBatch(dev: DeviceAuth, items: PushItem[]): Promise<PushResult[]> {
  const out: PushResult[] = [];
  for (const item of items.slice(0, PUSH_LIMIT)) out.push(await pushOne(dev, item));
  const tally = out.reduce<Record<string, number>>((t, r) => ((t[r.replayed ? "replayed" : r.status] = (t[r.replayed ? "replayed" : r.status] ?? 0) + 1), t), {});
  if (out.some((r) => !r.replayed)) {
    await db.$transaction((tx) => audit(tx, { orgId: dev.orgId, userId: dev.linkedById, action: "sync.upload", entity: "SyncDevice", entityId: dev.id, after: { device: dev.name, ...tally, rejected: out.filter((r) => r.status === "rejected").map((r) => r.reason).slice(0, 5) } }));
  }
  return out;
}

/** The gym's linked computers, for Settings › Cloud sync on the website. */
export async function listDevices(orgId: string) {
  return db.syncDevice.findMany({ where: { orgId }, orderBy: { linkedAt: "asc" } });
}

export { SYNC_ENTITIES };
