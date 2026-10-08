import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import type { CurrentUser } from "@/lib/auth/current";
import { hashPassword } from "@/lib/auth/password";
import { systemUser } from "@/lib/auth/system";
import { emailReady, sendEmail } from "@/lib/integrations/email";
import { deleteObject, getObject, putObject } from "@/lib/integrations/storage";
import { log } from "@/lib/log";
import {
  BACKUP_FORMAT,
  BACKUP_TABLES,
  RESTORE_TABLES,
  backupFileName,
  daysSince,
  decodeRow,
  encodeRow,
  parseBackup,
  type BackupFile,
  type Row,
  type TableSpec,
} from "@/lib/domain/backup";
import { audit } from "./audit";
import { allowDelete } from "./db-guard";
import { UserError, isUniqueViolation } from "./errors";
import { notify } from "./notifications";

// Settings › Backup. A backup is one JSON file with every table of one gym, kept in the app's
// private storage (<orgId>/backups/<id>.json) and listed in the Backup table. Restoring replaces
// the gym's rows with the file's in one transaction, after a safety copy of what is there.

export type BackupKind = "MANUAL" | "AUTO" | "PRE_RESTORE";
export const MAX_RESTORE_BYTES = 60 * 1024 * 1024;
const PAGE = 2000;
const CHUNK = 500;
const STORAGE_FULL = "Could not write the backup to the server's storage (full or not writable). Check STORAGE_DIR or the S3 settings.";

type Client = Prisma.TransactionClient | typeof db;
type Loose = {
  findMany: (a: unknown) => Promise<Row[]>;
  createMany: (a: { data: Row[] }) => Promise<unknown>;
  deleteMany: (a: { where: unknown }) => Promise<{ count: number }>;
};
/** The Prisma delegate of a model, by model name. */
const model = (client: Client, name: string) => (client as unknown as Record<string, Loose>)[name[0]!.toLowerCase() + name.slice(1)]!;

type Ctx = { orgId: string; memberIds: string[]; deviceIds: string[] };
const byOrg = (c: Ctx) => ({ orgId: c.orgId });
/** How each table's rows are found for one gym: by orgId, or through the parent that has one. */
const WHERE: Record<string, (c: Ctx) => Record<string, unknown>> = {
  Branch: byOrg,
  User: byOrg,
  UserBranch: (c) => ({ user: { orgId: c.orgId } }),
  // The WhatsApp Business connection holds a sealed token: it is not exported, and a restored gym connects again.
  Setting: (c) => ({ ...byOrg(c), key: { not: "whatsapp_cloud" } }),
  Sequence: byOrg,
  MonthLock: (c) => ({ branch: { orgId: c.orgId } }),
  MembershipPlan: byOrg,
  PlanPrice: (c) => ({ plan: { orgId: c.orgId } }),
  WorkoutPlan: byOrg,
  DietPlan: byOrg,
  Member: byOrg,
  Offer: byOrg,
  Invoice: byOrg,
  InvoiceItem: (c) => ({ invoice: { orgId: c.orgId } }),
  Membership: (c) => ({ branch: { orgId: c.orgId } }),
  Payment: byOrg,
  Purchase: byOrg,
  Expense: byOrg,
  PurchaseLine: (c) => ({ purchase: { orgId: c.orgId } }),
  VendorPayment: (c) => ({ purchase: { orgId: c.orgId } }),
  Asset: byOrg,
  Product: byOrg,
  StockMovement: (c) => ({ product: { orgId: c.orgId } }),
  Lead: byOrg,
  ClassSlot: byOrg,
  Booking: (c) => ({ classSlot: { orgId: c.orgId } }),
  Attendance: (c) => ({ branch: { orgId: c.orgId } }),
  ProgressLog: (c) => ({ member: { orgId: c.orgId } }),
  MembershipFreeze: byOrg,
  WhatsAppTemplate: byOrg,
  WhatsAppMessage: byOrg,
  AutopayMandate: byOrg,
  AutopayEvent: (c) => ({ mandate: { orgId: c.orgId } }),
  Notification: byOrg,
  AiProposal: byOrg,
  MemberDocument: byOrg,
  Device: byOrg,
  DeviceCommand: (c) => ({ device: { orgId: c.orgId } }),
  DeviceUser: (c) => ({ device: { orgId: c.orgId } }),
  BiometricTemplate: (c) => ({ memberId: { in: c.memberIds } }),
  AccessLog: (c) => ({ deviceId: { in: c.deviceIds } }),
  AuditLog: byOrg,
};
/** Tables with their own orgId column; a restore forces it to the restoring gym. */
const ORG_TABLES = new Set(Object.entries(WHERE).filter(([, w]) => w === byOrg).map(([n]) => n));
const INCLUDE: Record<string, unknown> = { User: { role: { select: { name: true } } }, Expense: { category: { select: { name: true, group: true } } } };

async function readAll(client: Client, spec: TableSpec, where: Record<string, unknown>) {
  const m = model(client, spec.name);
  const orderBy = (spec.order ?? ["id"]).map((k) => ({ [k]: "asc" }));
  const rows: Row[] = [];
  for (let skip = 0; ; skip += PAGE) {
    const page = await m.findMany({ where, orderBy, skip, take: PAGE, ...(INCLUDE[spec.name] ? { include: INCLUDE[spec.name] } : {}) });
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  return rows;
}

/** Joined names go into the file; the joined objects do not. */
function flatten(name: string, r: Row): Row {
  if (name === "User") {
    const { role, ...rest } = r as Row & { role: { name: string } };
    return { ...rest, roleName: role.name };
  }
  if (name === "Expense") {
    const { category, ...rest } = r as Row & { category: { name: string; group: string } };
    return { ...rest, categoryName: category.name, categoryGroup: category.group };
  }
  return r;
}

export type Counts = Record<string, number>;

const liveMember = (m: Row) => m.deletedAt === null && m.walkIn === false;

function countRows(tables: Record<string, Row[]>): Counts {
  const n = (t: string) => tables[t]?.length ?? 0;
  return {
    members: (tables.Member ?? []).filter(liveMember).length,
    invoices: n("Invoice"),
    payments: n("Payment"),
    expenses: n("Expense"),
    memberships: n("Membership"),
    leads: n("Lead"),
    attendance: n("Attendance"),
    products: n("Product"),
    assets: n("Asset"),
    purchases: n("Purchase"),
    staff: (tables.User ?? []).filter((u) => u.active === true && u.deletedAt === null).length,
    branches: n("Branch"),
    documents: n("MemberDocument"),
  };
}

/** Every table of one gym as the backup file's text, plus what it holds. */
export async function exportOrg(orgId: string, now = new Date()) {
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId }, select: { id: true, name: true, plan: true, planCycle: true, trialEndsAt: true, trainerCode: true } });
  const ctx: Ctx = { orgId, memberIds: [], deviceIds: [] };
  const tables: Record<string, Row[]> = {};
  let rows = 0;
  for (const spec of BACKUP_TABLES) {
    const raw = await readAll(db, spec, WHERE[spec.name]!(ctx));
    if (spec.name === "Member") ctx.memberIds = raw.map((r) => r.id as string);
    if (spec.name === "Device") ctx.deviceIds = raw.map((r) => r.id as string);
    tables[spec.name] = raw.map((r) => encodeRow(flatten(spec.name, r), spec));
    rows += raw.length;
  }
  const counts = countRows(tables);
  const file: BackupFile = { app: "fitron", format: BACKUP_FORMAT, exportedAt: now.toISOString(), org: { ...org, trialEndsAt: org.trialEndsAt?.toISOString() ?? null }, tables, counts };
  return { text: JSON.stringify(file), counts, rows, tables: BACKUP_TABLES.length, gymName: org.name, exportedAt: now };
}

type Actor = { orgId: string; id?: string; userId?: string | null };
const actorId = (a: Actor) => a.id ?? a.userId ?? null;

/** Exports the gym to a file in private storage and records it. A failed write is the prototype's "storage full" error. */
export async function createBackup(actor: Actor, kind: BackupKind, now = new Date()) {
  const x = await exportOrg(actor.orgId, now);
  const id = randomUUID();
  const storageKey = `${actor.orgId}/backups/${id}.json`;
  const bytes = new Uint8Array(Buffer.from(x.text, "utf8"));
  try {
    await putObject(storageKey, bytes, "application/json");
  } catch {
    throw new UserError(STORAGE_FULL);
  }
  const fileName = backupFileName(x.gymName, now);
  const userId = actorId(actor);
  try {
    return await db.$transaction(async (tx) => {
      const b = await tx.backup.create({
        data: { id, orgId: actor.orgId, kind, storageKey, fileName, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), format: BACKUP_FORMAT, counts: x.counts, tables: x.tables, rows: x.rows, createdById: userId, createdAt: now },
      });
      await audit(tx, { orgId: actor.orgId, userId, action: "backup.create", entity: "Backup", entityId: id, after: { kind, fileName, size: bytes.length, counts: x.counts } });
      return b;
    });
  } catch (e) {
    await deleteObject(storageKey).catch(() => {});
    throw e;
  }
}

async function userNames(ids: (string | null)[]) {
  const users = await db.user.findMany({ where: { id: { in: [...new Set(ids.filter((x): x is string => !!x))] } }, select: { id: true, name: true } });
  return (id: string | null) => (id ? (users.find((u) => u.id === id)?.name ?? "Staff") : "System");
}

/** Past backups, newest first, with who took them. */
export async function listBackups(orgId: string) {
  const rows = await db.backup.findMany({ where: { orgId }, orderBy: { createdAt: "desc" } });
  const name = await userNames(rows.flatMap((r) => [r.createdById, r.restoredById]));
  return rows.map((r) => ({ ...r, counts: r.counts as Counts, createdBy: name(r.createdById), restoredBy: r.restoredById ? name(r.restoredById) : null }));
}

/** Live counts of the records a backup would hold, as the Backup tab's "Records" row. */
export async function liveCounts(orgId: string): Promise<Counts> {
  const [members, invoices, payments] = await Promise.all([db.member.count({ where: { orgId, deletedAt: null, walkIn: false } }), db.invoice.count({ where: { orgId } }), db.payment.count({ where: { orgId } })]);
  return { members, invoices, payments };
}

/** The facts the Backup tab and the Go live checklist read. */
export async function backupStatus(orgId: string) {
  const [manual, auto, downloaded, agg, counts] = await Promise.all([
    db.backup.findFirst({ where: { orgId, kind: "MANUAL" }, orderBy: { createdAt: "desc" } }),
    db.backup.findFirst({ where: { orgId, kind: "AUTO" }, orderBy: { createdAt: "desc" } }),
    db.backup.findFirst({ where: { orgId, downloadedAt: { not: null } }, orderBy: { downloadedAt: "desc" } }),
    db.backup.aggregate({ where: { orgId }, _count: { _all: true }, _sum: { size: true } }),
    liveCounts(orgId),
  ]);
  const name = await userNames([manual?.createdById ?? null]);
  return {
    lastManualAt: manual?.createdAt ?? null,
    lastManualBy: manual ? name(manual.createdById) : null,
    lastAutoAt: auto?.createdAt ?? null,
    lastDownloadedAt: downloaded?.downloadedAt ?? null,
    files: agg._count._all,
    bytes: agg._sum.size ?? 0,
    counts,
  };
}

/** The latest automatic backup run that failed, for the tab's warning. */
export async function lastAutoFailure(orgId: string) {
  const run = await db.jobRun.findFirst({ where: { orgId, name: "backup.auto" }, orderBy: { startedAt: "desc" } });
  return run?.error ? { day: run.day, error: run.error } : null;
}

/** The file's bytes for a download; records the first download. Null when the backup is not this gym's. */
export async function readBackup(u: CurrentUser, id: string) {
  const backup = await db.backup.findFirst({ where: { id, orgId: u.orgId } });
  if (!backup) return null;
  const body = await getObject(backup.storageKey);
  await db.$transaction(async (tx) => {
    if (!backup.downloadedAt) await tx.backup.update({ where: { id }, data: { downloadedAt: new Date() } });
    await audit(tx, { orgId: u.orgId, userId: u.id, action: "backup.download", entity: "Backup", entityId: id, after: { fileName: backup.fileName, size: backup.size } });
  });
  return { backup, body };
}

export type RestoreSource = { backupId: string } | { file: File };

async function loadSource(u: CurrentUser, source: RestoreSource) {
  if ("backupId" in source) {
    const b = await db.backup.findFirst({ where: { id: source.backupId, orgId: u.orgId } });
    if (!b) throw new UserError("Backup not found.");
    return { text: Buffer.from(await getObject(b.storageKey)).toString("utf8"), backup: b };
  }
  const f = source.file;
  if (!f || typeof f.arrayBuffer !== "function" || f.size === 0) throw new UserError("Choose a backup file.", "file");
  if (f.size > MAX_RESTORE_BYTES) throw new UserError("That file is over 60 MB. Restore it from the server's list instead, or contact support@fitron.in.", "file");
  return { text: Buffer.from(await f.arrayBuffer()).toString("utf8"), backup: null };
}

/** Refuses a file whose rows point at rows that are not in it (an edited or truncated file). */
function checkRefs(file: BackupFile) {
  const ids = new Map<string, Set<string>>();
  for (const t of RESTORE_TABLES) ids.set(t.name, new Set((file.tables[t.name] ?? []).map((r) => String(r.id))));
  for (const t of RESTORE_TABLES) {
    for (const r of file.tables[t.name] ?? []) {
      if (typeof r !== "object" || r === null) throw new UserError("That file is not a Fitron backup.");
      for (const [key, parent] of Object.entries(t.refs ?? {})) {
        const v = r[key];
        if (v !== null && v !== undefined && !ids.get(parent)!.has(String(v))) throw new UserError(`The backup file is inconsistent: a ${t.name} row refers to a ${parent} that is not in the file.`);
      }
    }
  }
}

/**
 * Replaces every record of the gym with the backup's, in one transaction, after a safety copy.
 * Super Admin only, with "RESTORE" typed. Users are kept (passwords and sessions survive; staff
 * missing from the file are deactivated) and the audit log is never deleted.
 */
export async function restoreBackup(u: CurrentUser, source: RestoreSource, confirm: string, now = new Date()) {
  if (u.role !== "Super Admin") throw new UserError("Only a Super Admin can restore a backup.");
  if (confirm.trim() !== "RESTORE") throw new UserError("Type RESTORE to confirm.", "confirm");
  const r = await applyRestore(u, source, now, false);
  return { exportedAt: r.exportedAt, safetyBackupId: r.safetyBackupId!, counts: r.counts };
}

/** Thrown at the end of a restore test's transaction, so that the database rolls everything back. */
class RestoreTestDone extends Error {}

/**
 * The restore itself. With `dryRun` it does every step (the checks, the deletes, the inserts) inside the one transaction
 * and then throws RestoreTestDone as the transaction's last act, so nothing is ever committed: no safety copy is taken,
 * no audit row is written, and the staff lock-out check is skipped. The throw is unconditional and comes before anything
 * that records the restore.
 */
async function applyRestore(u: CurrentUser, source: RestoreSource, now: Date, dryRun: boolean) {
  const { text, backup } = await loadSource(u, source);
  const file = parseBackup(text);
  if (!file) throw new UserError("That file is not a Fitron backup.", "file");
  if (file.format > BACKUP_FORMAT) throw new UserError("This backup needs a newer version of Fitron.", "file");
  if (file.org.id !== u.orgId) throw new UserError("This backup was taken from a different gym.", "file");
  for (const t of RESTORE_TABLES) if (file.tables[t.name] !== undefined && !Array.isArray(file.tables[t.name])) throw new UserError("That file is not a Fitron backup.", "file");

  const roles = new Map((await db.role.findMany({ select: { id: true, name: true } })).map((r) => [r.name, r.id]));
  const fileUsers = file.tables.User ?? [];
  for (const fu of fileUsers) if (!roles.has(String(fu.roleName))) throw new UserError(`The backup has staff with a role this server doesn't know: ${String(fu.roleName)}.`, "file");
  if (!dryRun && !fileUsers.some((fu) => fu.id === u.id)) throw new UserError("You aren't in this backup's staff list, so restoring it would lock you out.", "file");
  const foreign = await db.user.findFirst({ where: { id: { in: fileUsers.map((fu) => String(fu.id)) }, orgId: { not: u.orgId } }, select: { id: true } });
  if (foreign) throw new UserError("The backup has staff that belong to another gym.", "file");
  checkRefs(file);

  // Never silently destroy data: what is there now becomes a backup first.
  const safety = dryRun ? null : await createBackup(u, "PRE_RESTORE", now);
  const current = (safety?.counts ?? {}) as Counts;
  const orgId = u.orgId;
  const result = { exportedAt: new Date(file.exportedAt), counts: file.counts, tables: Object.keys(file.tables).length, rows: Object.values(file.tables).reduce((n, t) => n + (Array.isArray(t) ? t.length : 0), 0) };

  try {
    await db.$transaction(
      async (tx) => {
        // The database refuses to delete money records unless told why; a restore replaces them with the file's.
        await allowDelete(tx, "restore");
        const ctx: Ctx = {
          orgId,
          memberIds: (await tx.member.findMany({ where: { orgId }, select: { id: true } })).map((m) => m.id),
          deviceIds: (await tx.device.findMany({ where: { orgId }, select: { id: true } })).map((d) => d.id),
        };
        // AI Trainer members linked to a gym member lose the link when the member row goes (SetNull); put it back after.
        const trainerLinks = await tx.trainerMember.findMany({ where: { orgId, gymMemberId: { not: null } }, select: { id: true, gymMemberId: true } });

        for (const spec of [...RESTORE_TABLES].reverse()) if (spec.name !== "User") await model(tx, spec.name).deleteMany({ where: WHERE[spec.name]!(ctx) });

        // Staff: upsert by id, keeping passwords; anyone not in the file is deactivated, not deleted.
        const existing = new Map((await tx.user.findMany({ where: { orgId }, select: { id: true } })).map((x) => [x.id, true]));
        for (const fu of fileUsers) {
          const { roleName, ...rest } = decodeRow(fu, { name: "User", strip: ["passwordHash"] });
          const data = { ...rest, orgId, roleId: roles.get(String(roleName))! } as Prisma.UserUncheckedCreateInput;
          if (existing.has(String(fu.id))) {
            await tx.user.update({ where: { id: String(fu.id) }, data: data as Prisma.UserUncheckedUpdateInput });
          } else {
            await tx.user.create({ data: { ...data, passwordHash: await hashPassword(randomUUID()) } });
          }
        }
        await tx.user.updateMany({ where: { orgId, id: { notIn: fileUsers.map((fu) => String(fu.id)) }, deletedAt: null }, data: { active: false, deletedAt: now } });

        // Expense categories are global; the file carries their names.
        const categories = new Map((await tx.expenseCategory.findMany()).map((c) => [c.name, c.id]));
        for (const e of file.tables.Expense ?? []) {
          const name = String(e.categoryName ?? "Other");
          if (!categories.has(name)) {
            const c = await tx.expenseCategory.create({ data: { id: `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${randomUUID().slice(0, 6)}`, name, group: String(e.categoryGroup ?? "Other") } });
            categories.set(name, c.id);
          }
        }

        for (const spec of RESTORE_TABLES) {
          if (spec.name === "User") continue;
          const rows = (file.tables[spec.name] ?? []).map((r) => {
            const row = decodeRow(r, spec);
            if (ORG_TABLES.has(spec.name)) row.orgId = orgId;
            if (spec.name === "Expense") {
              row.categoryId = categories.get(String(row.categoryName ?? "Other"))!;
              delete row.categoryName;
              delete row.categoryGroup;
            }
            return row;
          });
          for (let i = 0; i < rows.length; i += CHUNK) await model(tx, spec.name).createMany({ data: rows.slice(i, i + CHUNK) });
        }

        const restoredMembers = new Set((file.tables.Member ?? []).map((m) => String(m.id)));
        for (const l of trainerLinks) if (l.gymMemberId && restoredMembers.has(l.gymMemberId)) await tx.trainerMember.update({ where: { id: l.id }, data: { gymMemberId: l.gymMemberId } });

        if (dryRun) throw new RestoreTestDone();
        if (backup) await tx.backup.update({ where: { id: backup.id }, data: { restoredAt: now, restoredById: u.id } });
        await audit(tx, {
          orgId,
          userId: u.id,
          action: "backup.restore",
          entity: "Backup",
          entityId: backup?.id ?? "file",
          before: { counts: current },
          after: { counts: file.counts, exportedAt: file.exportedAt, fileName: backup?.fileName ?? ("file" in source ? source.file.name : null), safetyBackupId: safety!.id },
        });
      },
      { timeout: 300_000, maxWait: 20_000 },
    );
  } catch (e) {
    if (e instanceof RestoreTestDone) return { ...result, safetyBackupId: null };
    if (isUniqueViolation(e)) throw new UserError("The backup clashes with records that belong to another gym on this server (an id or email is already taken). Nothing was changed.");
    throw e;
  }
  return { ...result, safetyBackupId: safety!.id };
}

/**
 * The restore test: takes the gym's newest backup (an automatic or manual one) out of storage, checks that the stored
 * bytes are the ones that were written, and restores it for real inside a transaction that is rolled back at the end.
 * What it proves is that the file can be read, passes every check the real restore makes, and inserts into the
 * database as it is now (so a change to the tables since the backup was taken shows up). The gym's data is untouched:
 * but the transaction holds the gym's rows while it runs, so it belongs in the quiet hours. Null when there is no backup yet.
 */
export async function testRestore(orgId: string, now = new Date()) {
  const backup = await db.backup.findFirst({ where: { orgId, kind: { in: ["AUTO", "MANUAL"] } }, orderBy: { createdAt: "desc" } });
  if (!backup) return null;
  const bytes = await getObject(backup.storageKey).catch(() => {
    throw new Error(`The backup ${backup.fileName} is listed but its file is missing from storage.`);
  });
  if (createHash("sha256").update(bytes).digest("hex") !== backup.sha256) throw new Error(`The stored file of the backup ${backup.fileName} no longer matches its checksum, so it may be damaged.`);
  const started = Date.now();
  const u = await systemUser(orgId);
  const r = await applyRestore(u, { backupId: backup.id }, now, true);
  return { backup, rows: r.rows, tables: r.tables, ms: Date.now() - started };
}

/** What the tab shows about the weekly restore test: the last time it ran, and whether it passed. */
export async function lastRestoreTest(orgId: string) {
  const run = await db.jobRun.findFirst({ where: { orgId, name: "backup.test", finishedAt: { not: null } }, orderBy: { startedAt: "desc" } });
  if (!run) return null;
  const r = (run.result ?? {}) as { backup?: string; taken?: string; rows?: number; note?: string };
  if (run.error) return { ok: false as const, day: run.day, error: run.error };
  if (r.note) return { ok: null, day: run.day, note: r.note };
  return { ok: true as const, day: run.day, backup: r.backup ?? "", taken: r.taken ? new Date(r.taken) : null, rows: r.rows ?? 0 };
}

/** The mail to the gym's Super Admins when the restore test fails: the in-app notice is easy to miss, and this one matters. */
export async function alertRestoreTestFailed(orgId: string, error: string) {
  if (!emailReady()) return;
  const [org, owners] = await Promise.all([
    db.organization.findUniqueOrThrow({ where: { id: orgId }, select: { name: true } }),
    db.user.findMany({ where: { orgId, active: true, deletedAt: null, role: { name: "Super Admin" }, email: { not: "" } }, select: { email: true } }),
  ]);
  const text = [
    "Hello,",
    "",
    `Every week Fitron checks that the latest backup of ${org.name} can really be restored. This week's check failed:`,
    "",
    `  ${error}`,
    "",
    "Your live data is not affected, and nothing was changed by the check. But a backup that cannot be restored is not worth keeping, so please:",
    "  1. Open Settings › Backup and press \"Back up now\", then download the file and keep a copy off the server.",
    "  2. If this message comes again next week, write to support@fitron.in and include this email.",
    "",
    "FITRON",
  ].join("\n");
  for (const o of owners) {
    await sendEmail({ to: o.email, subject: `${org.name}: your latest backup could not be restored in a test`, text }).catch((e) => log.error("backup_test.alert_failed", e, { orgId }));
  }
}

const KEEP_DAYS: Record<string, number> = { AUTO: 30, MANUAL: 90, PRE_RESTORE: 90 };

/** Removes old backups: automatic ones after 30 days, manual ones after 90, always keeping the newest of each kind and any that was restored. */
export async function pruneBackups(orgId: string, now = new Date()) {
  const rows = await db.backup.findMany({ where: { orgId }, orderBy: { createdAt: "desc" } });
  const newest = new Set<string>();
  const seenKind = new Set<string>();
  for (const r of rows) {
    if (seenKind.has(r.kind)) continue;
    seenKind.add(r.kind);
    newest.add(r.id);
  }
  const old = rows.filter((r) => !newest.has(r.id) && !r.restoredAt && daysSince(r.createdAt, now) > (KEEP_DAYS[r.kind] ?? 90));
  for (const r of old) {
    await deleteObject(r.storageKey).catch(() => {});
    await db.backup.delete({ where: { id: r.id } });
  }
  if (old.length) {
    await db.$transaction((tx) => audit(tx, { orgId, userId: null, action: "backup.prune", entity: "Backup", entityId: "prune", after: { removed: old.map((r) => ({ id: r.id, fileName: r.fileName, kind: r.kind })) } }));
  }
  return old.length;
}

/** The prototype's weekly nudge: a "Backup due" alert when no manual backup was taken in the last 7 days. */
export async function backupNudge(orgId: string, now = new Date()): Promise<Record<string, number | string>> {
  const members = await db.member.count({ where: { orgId, deletedAt: null, walkIn: false } });
  if (!members) return { notified: 0, note: "no members" };
  const manual = await db.backup.findFirst({ where: { orgId, kind: "MANUAL" }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
  const days = manual ? daysSince(manual.createdAt, now) : null;
  if (days !== null && days < 7) return { notified: 0, note: `backup ${days} days old` };
  const recent = await db.notification.count({ where: { orgId, type: "BACKUP_DUE", createdAt: { gte: new Date(now.getTime() - 7 * 86_400_000) } } });
  if (recent) return { notified: 0, note: "already reminded" };
  const text = manual ? `Last manual backup was ${days} days ago. Download one from Settings › Backup.` : "No backup has been downloaded yet. Do it once a week from Settings › Backup.";
  await db.$transaction((tx) => notify(tx, { orgId, type: "BACKUP_DUE", text, link: "/settings/backup" }));
  return { notified: 1 };
}
