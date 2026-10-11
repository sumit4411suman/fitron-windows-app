import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/current";
import type { Prisma } from "@/generated/prisma/client";
import { entryBlock, passbackBlock } from "@/lib/domain/access";
import { cmd, parseAcks, parseAttlog, parseTemplates, verifyMethod, type Punch } from "@/lib/domain/adms";
import { getAccessRules } from "./attendance";
import { audit } from "./audit";
import { frozenBlocks } from "./freeze";
import { UserError } from "./errors";
import { memberScope, summarize } from "./members";
import { notify } from "./notifications";
import { nextNumber } from "./sequence";
import { fromIso, nowHHMM, todayIso } from "./time";
import { fmtStamp, fmtTime } from "@/lib/format";

type Device = Prisma.DeviceGetPayload<object>;

// ── Template encryption (DPDP: biometric data is sensitive) ───────────────

function key() {
  const k = process.env.BIOMETRIC_KEY?.trim();
  if (k) return createHash("sha256").update(k).digest();
  if (process.env.NODE_ENV === "production") throw new Error("BIOMETRIC_KEY is not set; refusing to store biometric templates.");
  return createHash("sha256").update("fitron-dev-only-biometric-key").digest();
}

export function seal(plain: string) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]);
}

export function unseal(b: Uint8Array) {
  const buf = Buffer.from(b);
  const d = createDecipheriv("aes-256-gcm", key(), buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString("utf8");
}

// ── What devices call ─────────────────────────────────────────────────────

/** A device calling in. Unknown serials are recorded for a Super Admin to approve; nothing they send is used until then. */
/** A device counts as online when it called in within the last five minutes. */
export const isDeviceOnline = (d: { lastSeenAt: Date | null }, now = Date.now()) => !!d.lastSeenAt && now - d.lastSeenAt.getTime() <= 5 * 60_000;

export async function deviceFor(serial: string, ip: string | null) {
  if (!/^[A-Za-z0-9_-]{4,40}$/.test(serial)) return null;
  const d = await db.device.upsert({ where: { serial }, create: { serial, ip }, update: { lastSeenAt: new Date(), ip } });
  return d.approved && d.orgId && d.branchId ? d : null;
}

/** A remote door-open command is only worth sending for this long; after that it is dropped unsent. */
export const DOOR_COMMAND_TTL_MS = 30_000;

async function queue(tx: Prisma.TransactionClient | typeof db, deviceId: string, command: string, expiresAt: Date | null = null) {
  const last = await tx.deviceCommand.findFirst({ where: { deviceId }, orderBy: { cmdNo: "desc" }, select: { cmdNo: true } });
  return tx.deviceCommand.create({ data: { deviceId, cmdNo: (last?.cmdNo ?? 0) + 1, command, expiresAt } });
}

/** Commands for the device's next poll, oldest first. Commands past their expiry (door openings) are marked EXPIRED and never sent. */
export async function pendingCommands(d: Device, now = new Date()) {
  await db.deviceCommand.updateMany({ where: { deviceId: d.id, status: "PENDING", expiresAt: { lte: now } }, data: { status: "EXPIRED" } });
  const list = await db.deviceCommand.findMany({ where: { deviceId: d.id, status: "PENDING" }, orderBy: { cmdNo: "asc" }, take: 20 });
  if (!list.length) return "OK";
  await db.deviceCommand.updateMany({ where: { id: { in: list.map((c) => c.id) } }, data: { status: "SENT", sentAt: new Date() } });
  return list.map((c) => `C:${c.cmdNo}:${c.command}`).join("\n") + "\n";
}

export async function acknowledge(d: Device, body: string) {
  for (const a of parseAcks(body)) {
    await db.deviceCommand.updateMany({ where: { deviceId: d.id, cmdNo: a.cmdNo }, data: { status: a.ret === "0" ? "DONE" : "FAILED", returnCode: a.ret, ackAt: new Date() } });
  }
  return "OK";
}

/** "2026-09-28 06:31:12" on the device clock (India time) → instant. */
const istToDate = (t: string) => new Date(new Date(`${t.replace(" ", "T")}.000Z`).getTime() - 330 * 60_000);

/**
 * Punches from a device: each is checked against the gym's entry rules and logged. The first allowed
 * punch of the day checks the member in; a later one (20+ minutes on) checks them out.
 * A member the rules now block is removed from the device so it refuses them next time.
 */
export async function recordPunches(d: Device, punches: Punch[]) {
  const orgId = d.orgId!;
  const today = todayIso();
  const rules = await getAccessRules(orgId);
  let n = 0;
  for (const p of punches) {
    const at = istToDate(p.time);
    if (Number.isNaN(at.getTime())) continue;
    const date = p.time.slice(0, 10);
    // Devices resend their buffer after a reconnect; skip punches already logged.
    if (await db.accessLog.findFirst({ where: { deviceId: d.id, pin: p.pin, at } })) {
      n++;
      continue;
    }
    const member = await db.member.findFirst({ where: { orgId, devicePin: p.pin, deletedAt: null } });
    const method = verifyMethod(p.verify);
    if (!member) {
      await db.accessLog.create({ data: { deviceId: d.id, branchId: d.branchId, pin: p.pin, method, result: "UNKNOWN", reason: "No member has this PIN", at } });
      n++;
      continue;
    }
    const s = (await summarize([member.id], date)).get(member.id)!;
    const block = entryBlock({ suspended: member.suspended, ...s }, rules, date, nowHHMM(at)) ?? (await frozenBlocks([member.id], date)).get(member.id) ?? null;
    await db.$transaction(async (tx) => {
      const log = (result: "ALLOWED" | "DENIED", reason: string | null) => tx.accessLog.create({ data: { deviceId: d.id, branchId: d.branchId, memberId: member.id, pin: p.pin, method, result, reason, at } });
      if (block) {
        await log("DENIED", block);
        if (date === today) await notify(tx, { orgId, branchId: d.branchId!, type: "CHECKIN_OVERRIDE", text: `${member.name} was refused at ${d.name ?? d.serial}: ${block}`, link: `/members/${member.id}` });
        return;
      }
      const open = await tx.attendance.findFirst({ where: { memberId: member.id, date: fromIso(date), checkOut: null }, orderBy: { checkIn: "desc" } });
      if (open) {
        if (at.getTime() - open.checkIn.getTime() >= 20 * 60_000) {
          await tx.attendance.update({ where: { id: open.id }, data: { checkOut: at } });
          await log("ALLOWED", "Check-out");
        } else {
          const pb = passbackBlock(rules, nowHHMM(open.checkIn));
          await log(pb ? "DENIED" : "ALLOWED", pb ?? "Already inside");
        }
      } else {
        const visitedToday = await tx.attendance.findFirst({ where: { memberId: member.id, date: fromIso(date), checkOut: { gt: new Date(at.getTime() - 20 * 60_000) } } });
        if (!visitedToday) await tx.attendance.create({ data: { branchId: d.branchId!, memberId: member.id, type: "MEMBER", date: fromIso(date), checkIn: at, method, deviceId: d.id } });
        await log("ALLOWED", visitedToday ? "Re-entry" : "Door opened · check-in");
      }
    });
    if (block) await setOnDevice(d, member, false);
    n++;
  }
  return n;
}

/** Templates the device uploads after an enrolment, stored encrypted against the member with that PIN. */
export async function storeTemplates(d: Device, body: string) {
  const list = parseTemplates(body);
  for (const t of list) {
    const member = await db.member.findFirst({ where: { orgId: d.orgId!, devicePin: t.pin, deletedAt: null }, select: { id: true, biometricConsentAt: true } });
    if (!member?.biometricConsentAt) continue;
    const data = seal(t.line);
    await db.biometricTemplate.upsert({
      where: { memberId_type_slot: { memberId: member.id, type: t.type, slot: t.slot } },
      create: { memberId: member.id, type: t.type, slot: t.slot, deviceId: d.id, data },
      update: { data, deviceId: d.id },
    });
  }
  return list.length;
}

export async function handleCdataPost(d: Device, table: string, body: string) {
  if (table === "ATTLOG") return `OK: ${await recordPunches(d, parseAttlog(body))}`;
  if (table === "OPERLOG" || table === "BIODATA") return `OK: ${await storeTemplates(d, body)}`;
  return "OK";
}

// ── Keeping devices in step with who may come in ──────────────────────────

async function setOnDevice(d: Device, m: { id: string; name: string; devicePin: string | null; cardNo: string | null }, allowed: boolean) {
  if (!m.devicePin) return false;
  const cur = await db.deviceUser.findUnique({ where: { deviceId_memberId: { deviceId: d.id, memberId: m.id } } });
  if (cur?.allowed === allowed) return false;
  await db.$transaction(async (tx) => {
    if (allowed) {
      await queue(tx, d.id, cmd.addUser(m.devicePin!, m.name, m.cardNo ?? ""));
      const templates = await tx.biometricTemplate.findMany({ where: { memberId: m.id } });
      for (const t of templates) await queue(tx, d.id, cmd.restoreTemplate({ type: t.type, line: unseal(t.data) }));
    } else {
      await queue(tx, d.id, cmd.deleteUser(m.devicePin!));
    }
    await tx.deviceUser.upsert({ where: { deviceId_memberId: { deviceId: d.id, memberId: m.id } }, create: { deviceId: d.id, memberId: m.id, allowed }, update: { allowed } });
  });
  return true;
}

/** Load allowed members onto each device of the gym and take blocked ones off. Runs daily and on demand. */
export async function syncDevices(orgId: string, today = todayIso()) {
  const devices = await db.device.findMany({ where: { orgId, approved: true } });
  if (!devices.length) return { devices: 0, changes: 0 };
  const members = await db.member.findMany({ where: { orgId, deletedAt: null, devicePin: { not: null } }, select: { id: true, name: true, devicePin: true, cardNo: true, suspended: true, branchId: true } });
  const sums = await summarize(members.map((m) => m.id), today);
  const rules = await getAccessRules(orgId);
  const frozen = await frozenBlocks(members.map((m) => m.id), today);
  let changes = 0;
  for (const d of devices) {
    for (const m of members) {
      const allowed = !entryBlock({ suspended: m.suspended, ...sums.get(m.id)! }, rules, today) && !frozen.has(m.id);
      if (await setOnDevice(d, m, allowed)) changes++;
    }
  }
  return { devices: devices.length, changes };
}

// ── Staff actions ─────────────────────────────────────────────────────────

export async function listDevices(u: CurrentUser) {
  const list = await db.device.findMany({ where: { orgId: u.orgId }, orderBy: { createdAt: "asc" } });
  const pending = await db.deviceCommand.groupBy({ by: ["deviceId"], where: { deviceId: { in: list.map((d) => d.id) }, status: { in: ["PENDING", "SENT"] } }, _count: { _all: true } });
  return list.map((d) => ({ ...d, queued: pending.find((p) => p.deviceId === d.id)?._count._all ?? 0 }));
}

export type DeviceInput = { serial: string; name: string; branchId: string; relaySeconds: number };

/**
 * Add a device by the serial number printed on it. Knowing the serial is the proof of ownership:
 * devices can't sign their requests, so one that called in before being added is only held, never
 * shown to anyone, until a gym adds its serial.
 */
export async function saveDevice(u: CurrentUser, v: DeviceInput) {
  if (!u.branchIds.includes(v.branchId)) throw new UserError("Pick one of your branches.", "branchId");
  const serial = v.serial.trim().toUpperCase();
  const before = await db.device.findUnique({ where: { serial } });
  if (before?.orgId && before.orgId !== u.orgId) throw new UserError("This device is registered to another gym. Remove it there first.", "serial");
  const after = await db.$transaction(async (tx) => {
    const data = { orgId: u.orgId, branchId: v.branchId, name: v.name, relaySeconds: v.relaySeconds, approved: true };
    const a = before ? await tx.device.update({ where: { id: before.id }, data }) : await tx.device.create({ data: { serial, ...data } });
    await audit(tx, { orgId: u.orgId, userId: u.id, action: before?.approved ? "device.update" : "device.add", entity: "Device", entityId: a.id, before: before ?? undefined, after: a });
    return a;
  });
  if (!before?.approved) await syncDevices(u.orgId);
  return after;
}

export async function removeDevice(u: CurrentUser, id: string) {
  const d = await db.device.findFirst({ where: { id, orgId: u.orgId } });
  if (!d) throw new UserError("Device not found.");
  await db.$transaction(async (tx) => {
    await tx.deviceCommand.deleteMany({ where: { deviceId: id } });
    await tx.deviceUser.deleteMany({ where: { deviceId: id } });
    await tx.device.update({ where: { id }, data: { approved: false, orgId: null, branchId: null } });
    await audit(tx, { orgId: u.orgId, userId: u.id, action: "device.remove", entity: "Device", entityId: id, before: d });
  });
}

/** "last seen 2 Oct 2026, 10:15" or "never called in", for messages about an offline device. */
export const lastSeenLabel = (d: { lastSeenAt: Date | null }) => (d.lastSeenAt ? `last seen ${fmtStamp(d.lastSeenAt)}, ${fmtTime(d.lastSeenAt)}` : "never called in");

/**
 * Open the door from the app. Refused when the device is offline: the command would sit in the queue
 * and open the door whenever the device next called in, long after anyone meant it to. The queued
 * command also expires after 30 seconds for the same reason.
 */
export async function openDoor(u: CurrentUser, id: string, now = new Date()) {
  const d = await db.device.findFirst({ where: { id, orgId: u.orgId, approved: true, branchId: { in: u.branchIds } } });
  if (!d) throw new UserError("Device not found.");
  const name = d.name ?? d.serial;
  if (!isDeviceOnline(d, now.getTime())) throw new UserError(`${name} is offline (${lastSeenLabel(d)}), so the door cannot be opened from here.`);
  const branch = await db.branch.findUnique({ where: { id: d.branchId! }, select: { name: true } });
  await db.$transaction(async (tx) => {
    await queue(tx, id, cmd.openDoor(d.relaySeconds), new Date(now.getTime() + DOOR_COMMAND_TTL_MS));
    await tx.accessLog.create({ data: { deviceId: id, branchId: d.branchId, memberId: null, pin: "", method: "Remote", result: "ALLOWED", reason: `Door opened remotely by ${u.name}`, at: now } });
    await audit(tx, { orgId: u.orgId, userId: u.id, action: "device.open-door", entity: "Device", entityId: id, after: { name, serial: d.serial, branch: branch?.name ?? null, relaySeconds: d.relaySeconds } });
  });
}

export async function recentAccess(u: CurrentUser, take = 30) {
  const devices = await db.device.findMany({ where: { orgId: u.orgId, branchId: { in: u.branchIds } }, select: { id: true, name: true, serial: true } });
  const logs = await db.accessLog.findMany({ where: { deviceId: { in: devices.map((d) => d.id) } }, orderBy: { at: "desc" }, take });
  const members = await db.member.findMany({ where: { id: { in: logs.map((l) => l.memberId).filter((x): x is string => !!x) } }, select: { id: true, name: true, code: true } });
  return logs.map((l) => ({ ...l, device: devices.find((d) => d.id === l.deviceId), member: members.find((m) => m.id === l.memberId) ?? null }));
}

/** Enrol a member on a device: record consent, give them a PIN, load them, and ask the device to capture. */
export async function enrol(u: CurrentUser, memberId: string, deviceId: string, kind: "FP" | "FACE", consent: boolean) {
  const m = await db.member.findFirst({ where: { id: memberId, orgId: u.orgId, branchId: { in: u.branchIds }, deletedAt: null, walkIn: false } });
  if (!m) throw new UserError("Member not found.");
  const d = await db.device.findFirst({ where: { id: deviceId, orgId: u.orgId, approved: true } });
  if (!d) throw new UserError("Pick a device.", "deviceId");
  if (!m.biometricConsentAt && !consent) throw new UserError("Take the member's written consent first, then tick the box.", "consent");
  await db.$transaction(async (tx) => {
    let pin = m.devicePin;
    if (!pin) pin = String(await nextNumber(tx, u.orgId, "devicePin", 1001));
    const after = await tx.member.update({ where: { id: m.id }, data: { devicePin: pin, biometricConsentAt: m.biometricConsentAt ?? new Date() } });
    if (!m.biometricConsentAt) await audit(tx, { orgId: u.orgId, userId: u.id, action: "member.biometric-consent", entity: "Member", entityId: m.id, before: { consent: null }, after: { consent: after.biometricConsentAt } });
    await queue(tx, d.id, cmd.addUser(pin, m.name, m.cardNo ?? ""));
    await queue(tx, d.id, kind === "FP" ? cmd.enrollFinger(pin) : cmd.enrollFace(pin));
    await tx.deviceUser.upsert({ where: { deviceId_memberId: { deviceId: d.id, memberId: m.id } }, create: { deviceId: d.id, memberId: m.id, allowed: true }, update: { allowed: true } });
    await audit(tx, { orgId: u.orgId, userId: u.id, action: "member.biometric-enrol", entity: "Member", entityId: m.id, after: { device: d.serial, kind, pin } });
  });
}

/** Delete a member's biometric data everywhere: templates here, and the user on every device. */
export async function eraseBiometrics(u: CurrentUser, memberId: string, tx?: Prisma.TransactionClient) {
  const run = async (t: Prisma.TransactionClient) => {
    const m = await t.member.findFirst({ where: { id: memberId, orgId: u.orgId } });
    if (!m) throw new UserError("Member not found.");
    if (!m.devicePin && !m.biometricConsentAt && !m.cardNo) return;
    await t.biometricTemplate.deleteMany({ where: { memberId } });
    if (m.devicePin) {
      const on = await t.deviceUser.findMany({ where: { memberId } });
      for (const x of on) await queue(t, x.deviceId, cmd.deleteUser(m.devicePin));
      await t.deviceUser.deleteMany({ where: { memberId } });
    }
    await t.member.update({ where: { id: memberId }, data: { biometricConsentAt: null, devicePin: null, cardNo: null } });
    await audit(t, { orgId: u.orgId, userId: u.id, action: "member.biometric-erase", entity: "Member", entityId: memberId });
  };
  return tx ? run(tx) : db.$transaction(run);
}

export async function memberBiometrics(memberId: string) {
  const [templates, devices] = await Promise.all([
    db.biometricTemplate.groupBy({ by: ["type"], where: { memberId }, _count: { _all: true } }),
    db.deviceUser.findMany({ where: { memberId }, include: { device: { select: { name: true, serial: true } } } }),
  ]);
  return { fingerprints: templates.find((t) => t.type === "FP")?._count._all ?? 0, faces: templates.find((t) => t.type === "FACE")?._count._all ?? 0, devices };
}

/** Re-push every member's validity (and the current rules' verdict) to one device. */
export async function syncDevice(u: CurrentUser, deviceId: string) {
  const d = await db.device.findFirst({ where: { id: deviceId, orgId: u.orgId, approved: true, branchId: { in: u.branchIds } } });
  if (!d) throw new UserError("Device not found.");
  const today = todayIso();
  const members = await db.member.findMany({ where: { orgId: u.orgId, deletedAt: null, devicePin: { not: null } }, select: { id: true, name: true, devicePin: true, cardNo: true, suspended: true, branchId: true } });
  const sums = await summarize(members.map((m) => m.id), today);
  const rules = await getAccessRules(u.orgId);
  const frozen = await frozenBlocks(members.map((m) => m.id), today);
  const templates = await db.biometricTemplate.findMany({ where: { memberId: { in: members.map((m) => m.id) } } });
  let commands = 0;
  let allowedCount = 0;
  await db.$transaction(async (tx) => {
    for (const m of members) {
      const allowed = !entryBlock({ suspended: m.suspended, ...sums.get(m.id)! }, rules, today) && !frozen.has(m.id);
      if (allowed) {
        allowedCount++;
        await queue(tx, d.id, cmd.addUser(m.devicePin!, m.name, m.cardNo ?? ""));
        commands++;
        for (const t of templates.filter((x) => x.memberId === m.id)) {
          await queue(tx, d.id, cmd.restoreTemplate({ type: t.type, line: unseal(t.data) }));
          commands++;
        }
      } else {
        await queue(tx, d.id, cmd.deleteUser(m.devicePin!));
        commands++;
      }
      await tx.deviceUser.upsert({ where: { deviceId_memberId: { deviceId: d.id, memberId: m.id } }, create: { deviceId: d.id, memberId: m.id, allowed }, update: { allowed } });
    }
    await audit(tx, { orgId: u.orgId, userId: u.id, action: "device.sync", entity: "Device", entityId: d.id, after: { name: d.name ?? d.serial, members: members.length, allowed: allowedCount, removed: members.length - allowedCount, commands } });
  });
  return { members: members.length, commands, device: d.name ?? d.serial };
}

/** Assign (or clear) a member's RFID card and push it to the devices. */
export async function assignCard(u: CurrentUser, memberId: string, cardInput: string) {
  const m = await db.member.findFirst({ where: { ...memberScope(u), id: memberId, walkIn: false } });
  if (!m) throw new UserError("Member not found.");
  const card = cardInput.trim();
  if (card !== "" && !/^\d{1,20}$/.test(card)) throw new UserError("Type the number printed on the card (digits only).", "card");
  if (card) {
    const other = await db.member.findFirst({ where: { orgId: u.orgId, cardNo: card, deletedAt: null, id: { not: m.id } }, select: { name: true } });
    if (other) throw new UserError(`This card is already assigned to ${other.name}.`, "card");
  }
  const today = todayIso();
  const [sum, frozen, rules, devices] = await Promise.all([
    summarize([m.id], today),
    frozenBlocks([m.id], today),
    getAccessRules(u.orgId),
    db.device.findMany({ where: { orgId: u.orgId, approved: true } }),
  ]);
  const allowed = !entryBlock({ suspended: m.suspended, ...sum.get(m.id)! }, rules, today) && !frozen.has(m.id);
  try {
    await db.$transaction(async (tx) => {
      const pin = m.devicePin ?? String(await nextNumber(tx, u.orgId, "devicePin", 1001));
      await tx.member.update({ where: { id: m.id }, data: { devicePin: pin, cardNo: card || null } });
      await audit(tx, { orgId: u.orgId, userId: u.id, action: "member.rfid-card", entity: "Member", entityId: m.id, before: { card: m.cardNo }, after: { card: card || null } });
      if (allowed) {
        for (const d of devices) {
          await queue(tx, d.id, cmd.addUser(pin, m.name, card));
          await tx.deviceUser.upsert({ where: { deviceId_memberId: { deviceId: d.id, memberId: m.id } }, create: { deviceId: d.id, memberId: m.id, allowed: true }, update: { allowed: true } });
        }
      }
    });
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") throw new UserError("This card is already assigned to another member.", "card");
    throw e;
  }
  return { card: card || null };
}

/** Run a punch's checks for a member without touching attendance, devices or notifications; logs one "Test" row. */
export async function testScan(u: CurrentUser, memberId: string) {
  const m = await db.member.findFirst({ where: { ...memberScope(u), id: memberId, walkIn: false } });
  if (!m) throw new UserError("Member not found.");
  if (!m.devicePin && !m.cardNo) throw new UserError(`${m.name} is not on any device yet. Enrol them or assign a card first.`);
  const d = await db.device.findFirst({ where: { orgId: u.orgId, approved: true, branchId: { in: u.branchIds } }, orderBy: { createdAt: "asc" } });
  if (!d) throw new UserError("Add a device first.");
  const now = new Date();
  const today = todayIso();
  const rules = await getAccessRules(u.orgId);
  const s = (await summarize([m.id], today)).get(m.id)!;
  let block = (await frozenBlocks([m.id], today)).get(m.id) ?? entryBlock({ suspended: m.suspended, ...s }, rules, today, nowHHMM(now)) ?? null;
  let reason = `Test scan by ${u.name}`;
  if (!block) {
    const open = await db.attendance.findFirst({ where: { memberId: m.id, date: fromIso(today), checkOut: null }, orderBy: { checkIn: "desc" } });
    if (open) {
      if (now.getTime() - open.checkIn.getTime() >= 20 * 60_000) reason = `Would check out · test by ${u.name}`;
      else block = passbackBlock(rules, nowHHMM(open.checkIn));
    }
  }
  await db.accessLog.create({ data: { deviceId: d.id, branchId: d.branchId, memberId: m.id, pin: m.devicePin ?? "", method: "Test", result: block ? "DENIED" : "ALLOWED", reason: block ?? reason, at: now } });
  return { name: m.name, allowed: !block, reason: block };
}
