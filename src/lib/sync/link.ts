import "server-only";
import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import type { CurrentUser } from "@/lib/auth/current";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { audit } from "@/lib/services/audit";
import { UserError } from "@/lib/services/errors";
import { makeRecoveryKey, RECOVERY_SETTING, recoveryValue } from "@/lib/services/local-setup";
import { DEVICE_RANGE } from "@/lib/services/sequence";
import { cloudCall, cloudUrl } from "@/lib/integrations/sync";
import { copyDatabaseInto, createLocalBackup } from "@/lib/runtime/fitron-backup";
import { integrityCheck, migrateLocal, migrationsDir } from "@/lib/runtime/local-migrate";
import { makeLocalClient } from "@/lib/runtime/local-client";
import { dataDirs } from "@/lib/runtime/paths";
import { readLocalSecrets } from "@/lib/runtime/local-secrets";
import { isLocal } from "@/lib/runtime/edition";
import { ensureExpenseCategories, ensureRoles } from "../../../prisma/roles";
import { downloadGym, readState, sealToken, tokenOf } from "./client";
import { orgSql, SYNC_ENTITIES } from "./entities";
import { SYNC_MODEL } from "./model.generated";
import { keyExpr } from "./triggers";
import type { GymCheck, LinkedGym } from "./protocol";
import { startSyncWorker, stopSyncWorker } from "./worker";

// Linking this computer to fitron.in (Settings › Cloud sync), one of two ways, so both sides name every record alike:
//   from fitron.in    the gym already on fitron.in comes down to this computer, replacing what is here (after a safety
//                     backup; when this computer has records of its own, only once the owner typed REPLACE)
//   to fitron.in      the gym set up on this computer becomes a new fitron.in account, and its records go up
// A computer and a website that each kept separate books for the gym cannot be merged into one set: the owner picks.

export type Credentials = { email: string; password: string; code?: string };

const installationId = () => readLocalSecrets(dataDirs().root).installationId ?? undefined;
const deviceName = () => `FITRON for Windows${process.env.COMPUTERNAME ? ` (${process.env.COMPUTERNAME})` : ""}`.slice(0, 80);

async function localCounts(orgId: string) {
  const [members, invoices, payments] = await Promise.all([db.member.count({ where: { orgId, walkIn: false } }), db.invoice.count({ where: { orgId } }), db.payment.count({ where: { orgId } })]);
  return { members, invoices, payments };
}

function assertCanLink() {
  if (!isLocal()) throw new UserError("Linking is for FITRON on a computer.");
}

/** What the fitron.in account holds and what this computer holds, before the owner chooses. */
export async function checkCloud(u: CurrentUser, c: Credentials): Promise<{ cloud: GymCheck; here: Awaited<ReturnType<typeof localCounts>> }> {
  assertCanLink();
  const cloud = await cloudCall<GymCheck>(cloudUrl(), "/api/sync/link", { method: "POST", body: { mode: "check", ...c } });
  return { cloud, here: await localCounts(u.orgId) };
}

/**
 * The gym on fitron.in comes to this computer. A new database is built beside the live one (the same migrations, the
 * gym's records downloaded into it), checked, and copied in as one transaction; the old one is in the safety backup.
 * Everyone is signed out: the owner signs in with their fitron.in email and password, and gets a new recovery key.
 */
export async function linkFromCloud(u: CurrentUser, c: Credentials & { confirm?: string }): Promise<{ gym: string; recoveryKey: string; safetyBackup: string; userId: string }> {
  assertCanLink();
  if ((await readState())?.linked) throw new UserError("This computer is already linked. Unlink it first.");
  const here = await localCounts(u.orgId);
  if ((here.members || here.invoices || here.payments) && c.confirm?.trim() !== "REPLACE")
    throw new UserError(`This computer has its own records (${here.members} members, ${here.invoices} invoices, ${here.payments} payments). They are replaced by the gym on fitron.in; a safety backup keeps them. Type REPLACE to go ahead.`, "confirm");
  const base = cloudUrl();
  const linked = await cloudCall<LinkedGym>(base, "/api/sync/link", { method: "POST", body: { mode: "link", email: c.email, password: c.password, code: c.code, name: deviceName(), installationId: installationId() } });
  const dirs = dataDirs();
  const safety = await createLocalBackup({ dirs, kind: "safety", appVersion: process.env.APP_VERSION ?? "0.0.0", note: "Before linking this computer to fitron.in" });
  const work = path.join(dirs.root, `link-${randomBytes(6).toString("hex")}`);
  await mkdir(work, { recursive: true });
  const file = path.join(work, "fitron.db");
  const recoveryKey = makeRecoveryKey();
  stopSyncWorker();
  try {
    migrateLocal(file, migrationsDir());
    const wc = makeLocalClient(`file:${file}`);
    try {
      await ensureRoles(wc);
      await ensureExpenseCategories(wc);
      await wc.organization.create({ data: { id: linked.org.id, name: linked.org.name, plan: "enterprise", planCycle: "YEARLY" } });
      const start = await downloadGym({ base, token: linked.token, client: wc, orgId: linked.org.id, removeMissing: false });
      // The owner signs in here with the password they just typed; nobody else can until a Super Admin sets theirs.
      await wc.user.update({ where: { id: linked.user.id }, data: { passwordHash: await hashPassword(c.password), emailVerifiedAt: new Date() } });
      await wc.setting.upsert({ where: { orgId_key: { orgId: linked.org.id, key: RECOVERY_SETTING } }, create: { orgId: linked.org.id, key: RECOVERY_SETTING, value: await recoveryValue(recoveryKey) }, update: { value: await recoveryValue(recoveryKey) } });
      await wc.syncState.create({
        data: { id: 1, linked: true, cloudUrl: base, orgId: linked.org.id, deviceId: linked.device.id, deviceNo: linked.device.no, token: sealToken(linked.token), linkedEmail: linked.user.email, linkedAt: new Date(), pulledSeq: BigInt(Math.min(linked.seq, start)), appliedSeq: BigInt(start) },
      });
      await wc.$transaction((tx) => audit(tx, { orgId: linked.org.id, userId: linked.user.id, action: "sync.linked", entity: "SyncState", entityId: linked.device.id, after: { from: "fitron.in", device: linked.device.no, safetyBackup: safety.name } }));
    } finally {
      await wc.$disconnect();
    }
    if (!integrityCheck(file).ok) throw new UserError("The downloaded gym failed its check, so nothing was changed. Try again.");
    copyDatabaseInto(file, dirs.database);
  } finally {
    if (existsSync(work)) await rm(work, { recursive: true, force: true });
  }
  startSyncWorker();
  return { gym: linked.org.name, recoveryKey, safetyBackup: safety.name, userId: linked.user.id };
}

/**
 * The gym set up on this computer goes to fitron.in as a new account, owned by the person signed in here (a new
 * fitron.in password; the email to be confirmed there). Every record is queued for upload in the same transaction that
 * links the computer, so none is missed and none goes twice.
 */
export async function linkToCloud(u: CurrentUser, d: { email: string; password: string }): Promise<{ gym: string; queued: number }> {
  assertCanLink();
  if ((await readState())?.linked) throw new UserError("This computer is already linked. Unlink it first.");
  const me = await db.user.findUniqueOrThrow({ where: { id: u.id }, include: { role: true, org: true } });
  if (me.role.name !== "Super Admin") throw new UserError("Only a Super Admin can put the gym on fitron.in.");
  const sequences = (await db.sequence.findMany({ where: { orgId: me.orgId } })).map((s) => ({ name: s.name, next: s.next }));
  const base = cloudUrl();
  const reg = await cloudCall<LinkedGym>(base, "/api/sync/register", {
    method: "POST",
    body: { email: d.email, password: d.password, name: me.name, phone: me.phone, gymName: me.org.name, orgId: me.orgId, ownerId: me.id, deviceName: deviceName(), installationId: installationId(), sequences },
  });
  const queued = await db.$transaction(
    async (tx) => {
      await tx.syncState.upsert({
        where: { id: 1 },
        create: { id: 1, linked: true, cloudUrl: base, orgId: me.orgId, deviceId: reg.device.id, deviceNo: reg.device.no, token: sealToken(reg.token), linkedEmail: reg.user.email, linkedAt: new Date(), pulledSeq: BigInt(reg.seq) },
        update: { linked: true, cloudUrl: base, orgId: me.orgId, deviceId: reg.device.id, deviceNo: reg.device.no, token: sealToken(reg.token), linkedEmail: reg.user.email, linkedAt: new Date(), pulledSeq: BigInt(reg.seq), needsSnapshot: false, lastError: null, failures: 0 },
      });
      let n = 0;
      for (const e of SYNC_ENTITIES) {
        const pk = SYNC_MODEL[e.name]!.pk;
        const skip = e.skipKeys?.length ? ` AND R."key" NOT IN (${e.skipKeys.map((k) => `'${k}'`).join(", ")})` : "";
        n += await tx.$executeRawUnsafe(
          `INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "origin", "status", "attempts", "createdAt")
           SELECT lower(hex(randomblob(16))), ${orgSql(e, "R")}, '${e.name}', ${keyExpr(pk, "R")}, 'upsert', 'local', 'PENDING', 0, strftime('%Y-%m-%dT%H:%M:%f', 'now') || '+00:00'
           FROM "${e.name}" AS R WHERE ${orgSql(e, "R")} = ?${skip} ORDER BY R.rowid`,
          me.orgId,
        );
      }
      // From now on this computer numbers from its own range; the website carries on after the numbers used so far.
      const floor = reg.device.no * DEVICE_RANGE;
      await tx.$executeRaw`UPDATE "Sequence" SET "next" = "next" + ${floor} WHERE "orgId" = ${me.orgId} AND "next" < ${floor}`;
      await audit(tx, { orgId: me.orgId, userId: me.id, action: "sync.linked", entity: "SyncState", entityId: reg.device.id, after: { to: "fitron.in", email: reg.user.email, queued: n } });
      return n;
    },
    { timeout: 300_000, maxWait: 30_000 },
  );
  startSyncWorker();
  return { gym: me.org.name, queued };
}

/** Stops syncing: fitron.in forgets this computer's token (when it can be reached) and this computer stops recording. */
export async function unlinkComputer(u: CurrentUser): Promise<void> {
  const s = await readState();
  if (!s?.linked) return;
  stopSyncWorker();
  try {
    await cloudCall(s.cloudUrl || cloudUrl(), "/api/sync/unlink", { method: "POST", token: tokenOf(s), timeoutMs: 15_000 });
  } catch {
    // Offline, or already unlinked there: the website's Settings › Cloud sync can unlink it too.
  }
  await db.$transaction(async (tx) => {
    await tx.syncState.update({ where: { id: 1 }, data: { linked: false, token: null, lastError: null, failures: 0 } });
    await tx.syncChange.updateMany({ where: { status: "PENDING" }, data: { status: "DONE", error: "Not sent: the computer was unlinked." } });
    await audit(tx, { orgId: u.orgId, userId: u.id, action: "sync.unlinked", entity: "SyncState", entityId: s.deviceId, before: { email: s.linkedEmail } });
  });
}
