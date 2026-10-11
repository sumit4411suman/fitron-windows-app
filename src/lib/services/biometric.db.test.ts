import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { hasDb, makeGym, pick } from "@/test/db";
import { addDays } from "@/lib/domain/dates";
import { createMember, deleteMember } from "./members";
import { createPlan } from "./plans";
import { sellMembership } from "./billing";
import { assignCard, enrol, openDoor, pendingCommands, saveDevice, syncDevice, syncDevices, testScan, unseal, eraseBiometrics } from "./biometric";
import { severityOf } from "@/lib/domain/audit";
import { findForCheckIn } from "./attendance";
import { putSetting } from "./settings";
import { todayIso } from "./time";
import { GET as cdataGet, POST as cdataPost } from "@/app/iclock/cdata/route";
import { GET as poll } from "@/app/iclock/getrequest/route";
import { POST as ack } from "@/app/iclock/devicecmd/route";

const base = "http://gym.test/iclock";
const call = async (fn: (r: Request) => Promise<Response>, path: string, body?: string) => {
  const res = await fn(new Request(`${base}/${path}`, body === undefined ? {} : { method: "POST", body }));
  return { status: res.status, text: await res.text() };
};

describe.skipIf(!hasDb)("Biometric door devices (database)", () => {
  let gym: Awaited<ReturnType<typeof makeGym>>;
  let admin: Awaited<ReturnType<Awaited<ReturnType<typeof makeGym>>["user"]>>;
  let active: string;
  let lapsed: string;
  const serial = `T${randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase()}`;
  const today = todayIso();

  beforeAll(async () => {
    gym = await makeGym();
    admin = pick(await gym.user("Super Admin"), gym.a.id);
    const plan = await createPlan(admin, { name: "Monthly", kind: "Membership", months: 1, price: 100000, regFee: 0, discount: 0, gstApplicable: false, features: [] });
    const a = await createMember(admin, { name: "Asha Active", gender: "Female", phone: "9855500001", source: "Walk-in", tags: [] });
    const b = await createMember(admin, { name: "Lalit Lapsed", gender: "Male", phone: "9855500002", source: "Walk-in", tags: [] });
    active = a.id;
    lapsed = b.id;
    await sellMembership(admin, a.id, { planId: plan.id, startDate: addDays(today, -5), discount: 0, includeRegFee: true, payAmount: 100000, payMethod: "Cash" as const });
    await sellMembership(admin, b.id, { planId: plan.id, startDate: addDays(today, -5), discount: 0, includeRegFee: true, payAmount: 100000, payMethod: "Cash" as const });
  });

  it("holds an unknown device and ignores what it sends until a gym adds its serial", async () => {
    const r = await call(cdataGet, `cdata?SN=${serial}&options=all`);
    expect(r.text).toContain(`GET OPTION FROM: ${serial}`);
    expect((await db.device.findUniqueOrThrow({ where: { serial } })).approved).toBe(false);
    expect((await call(cdataPost, `cdata?SN=${serial}&table=ATTLOG`, `1001\t${today} 06:00:00\t0\t1\n`)).text).toBe("OK");
    expect(await db.accessLog.count({ where: { deviceId: (await db.device.findUniqueOrThrow({ where: { serial } })).id } })).toBe(0);
    expect((await call(poll, `getrequest?SN=${serial}`)).text).toBe("OK");

    await saveDevice(admin, { serial, name: "Main door", branchId: gym.a.id, relaySeconds: 5 });
    const other = await makeGym();
    const stranger = pick(await other.user("Super Admin"), other.a.id);
    await expect(saveDevice(stranger, { serial, name: "Mine", branchId: other.a.id, relaySeconds: 5 })).rejects.toThrow(/another gym/);
  });

  it("enrols with consent, sends commands on the next poll and records the results", async () => {
    const d = await db.device.findUniqueOrThrow({ where: { serial } });
    await expect(enrol(admin, active, d.id, "FP", false)).rejects.toThrow(/consent/);
    await enrol(admin, active, d.id, "FP", true);
    await enrol(admin, lapsed, d.id, "FACE", true);
    const m = await db.member.findUniqueOrThrow({ where: { id: active } });
    expect(m.devicePin).toMatch(/^\d+$/);
    expect(m.biometricConsentAt).not.toBeNull();

    const r = await call(poll, `getrequest?SN=${serial}`);
    const lines = r.text.trim().split("\n");
    expect(lines[0]).toBe(`C:1:DATA UPDATE USERINFO PIN=${m.devicePin}\tName=Asha Active\tPri=0\tPasswd=\tCard=\tGrp=1\tTZ=0000000100000000\tVerify=0`);
    expect(lines[1]).toBe(`C:2:ENROLL_FP PIN=${m.devicePin}\tFID=6\tRETRY=3\tOVERWRITE=1`);
    expect((await call(poll, `getrequest?SN=${serial}`)).text).toBe("OK");
    await call(ack, `devicecmd?SN=${serial}`, "ID=1&Return=0&CMD=DATA\nID=2&Return=-1002&CMD=ENROLL_FP\n");
    const cmds = await db.deviceCommand.findMany({ where: { deviceId: d.id, cmdNo: { in: [1, 2] } }, orderBy: { cmdNo: "asc" } });
    expect(cmds.map((c) => c.status)).toEqual(["DONE", "FAILED"]);

    // The device uploads the captured template; it is stored encrypted.
    await call(cdataPost, `cdata?SN=${serial}&table=OPERLOG`, `FP PIN=${m.devicePin}\tFID=6\tSize=4\tValid=1\tTMP=SECRETTEMPLATE\n`);
    const t = await db.biometricTemplate.findFirstOrThrow({ where: { memberId: active } });
    expect(Buffer.from(t.data).toString("latin1")).not.toContain("SECRETTEMPLATE");
    expect(unseal(t.data)).toContain("TMP=SECRETTEMPLATE");
  });

  it("turns punches into check-in and check-out, and refuses a member whose plan ended", async () => {
    const pin = (await db.member.findUniqueOrThrow({ where: { id: active } })).devicePin!;
    const r = await call(cdataPost, `cdata?SN=${serial}&table=ATTLOG`, `${pin}\t${today} 06:00:00\t0\t1\n${pin}\t${today} 06:00:00\t0\t1\n${pin}\t${today} 07:10:00\t0\t1\n424242\t${today} 06:05:00\t0\t15\n`);
    expect(r.text).toBe("OK: 4");
    const visits = await db.attendance.findMany({ where: { memberId: active } });
    expect(visits).toHaveLength(1);
    expect(visits[0]!.method).toBe("Fingerprint");
    expect(visits[0]!.checkOut).not.toBeNull();
    expect(await db.accessLog.count({ where: { pin: "424242", result: "UNKNOWN" } })).toBeGreaterThan(0);

    // Lalit's plan is ended early: his next punch is refused and he is taken off the device.
    await db.membership.updateMany({ where: { memberId: lapsed }, data: { endDate: new Date(`${addDays(today, -1)}T00:00:00Z`) } });
    const lpin = (await db.member.findUniqueOrThrow({ where: { id: lapsed } })).devicePin!;
    await call(cdataPost, `cdata?SN=${serial}&table=ATTLOG`, `${lpin}\t${today} 06:30:00\t0\t15\n`);
    expect(await db.attendance.count({ where: { memberId: lapsed } })).toBe(0);
    expect((await db.accessLog.findFirstOrThrow({ where: { memberId: lapsed } })).result).toBe("DENIED");
    expect((await call(poll, `getrequest?SN=${serial}`)).text).toContain(`DATA DELETE USERINFO PIN=${lpin}`);
    // The daily sync agrees and has nothing more to do.
    expect((await syncDevices(gym.org.id, today)).changes).toBe(0);
  });

  it("deletes biometric data when the member is deleted", async () => {
    const pin = (await db.member.findUniqueOrThrow({ where: { id: active } })).devicePin!;
    await deleteMember(admin, active, "test cleanup");
    expect(await db.biometricTemplate.count({ where: { memberId: active } })).toBe(0);
    expect((await call(poll, `getrequest?SN=${serial}`)).text).toContain(`DATA DELETE USERINFO PIN=${pin}`);
    const m = await db.member.findUniqueOrThrow({ where: { id: active } });
    expect(m.biometricConsentAt).toBeNull();
  });
});

describe.skipIf(!hasDb)("Anti-passback, RFID cards, sync, test scan and remote door (database)", () => {
  let gym: Awaited<ReturnType<typeof makeGym>>;
  let admin: Awaited<ReturnType<Awaited<ReturnType<typeof makeGym>>["user"]>>;
  let dev: { id: string };
  let a: string;
  let b: string;
  let lapsed: string;
  const serial = `T${randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase()}`;
  const today = todayIso();
  const punch = (pin: string, date: string, time: string) => call(cdataPost, `cdata?SN=${serial}&table=ATTLOG`, `${pin}\t${date} ${time}\t0\t1\n`);
  const queued = async (like: string) => (await db.deviceCommand.findMany({ where: { deviceId: dev.id, command: { contains: like } } })).length;

  beforeAll(async () => {
    gym = await makeGym();
    admin = pick(await gym.user("Super Admin"), gym.a.id);
    const plan = await createPlan(admin, { name: "Monthly", kind: "Membership", months: 1, price: 100000, regFee: 0, discount: 0, gstApplicable: false, features: [] });
    const mk = async (name: string, phone: string, start: number) => {
      const m = await createMember(admin, { name, gender: "Female", phone, source: "Walk-in", tags: [] });
      await sellMembership(admin, m.id, { planId: plan.id, startDate: addDays(today, start), discount: 0, includeRegFee: true, payAmount: 100000, payMethod: "Cash" as const });
      return m.id;
    };
    a = await mk("Ria Rfid", "9855510001", -5);
    b = await mk("Bo Second", "9855510002", -5);
    lapsed = await mk("Lena Lapsed", "9855510003", -5);
    await db.membership.updateMany({ where: { memberId: lapsed }, data: { endDate: new Date(`${addDays(today, -1)}T00:00:00Z`) } });
    dev = await saveDevice(admin, { serial, name: "Front door", branchId: gym.a.id, relaySeconds: 5 });
  });

  it("refuses a second entry while inside when anti-passback is on, and allows the exit after 20 minutes", async () => {
    await enrol(admin, a, dev.id, "FP", true);
    const pin = (await db.member.findUniqueOrThrow({ where: { id: a } })).devicePin!;
    const day = addDays(today, -1);
    await punch(pin, day, "06:00:00");
    await punch(pin, day, "06:05:00");
    const logs = await db.accessLog.findMany({ where: { memberId: a }, orderBy: { at: "asc" } });
    expect(logs[0]!.result).toBe("ALLOWED");
    expect(logs[1]!.result).toBe("DENIED");
    expect(logs[1]!.reason).toMatch(/Already inside since 06:00/);
    const visits = await db.attendance.findMany({ where: { memberId: a } });
    expect(visits).toHaveLength(1);
    expect(visits[0]!.checkOut).toBeNull();
    expect(await queued(`DELETE USERINFO PIN=${pin}`)).toBe(0);
    expect(await db.notification.count({ where: { orgId: gym.org.id, type: "CHECKIN_OVERRIDE" } })).toBe(0);
    await punch(pin, day, "06:30:00");
    const out = await db.accessLog.findFirstOrThrow({ where: { memberId: a }, orderBy: { at: "desc" } });
    expect(out.result).toBe("ALLOWED");
    expect(out.reason).toBe("Check-out");
    expect((await db.attendance.findFirstOrThrow({ where: { memberId: a } })).checkOut).not.toBeNull();
  });

  it("lets the member through with an explicit reason when anti-passback is off", async () => {
    await putSetting(admin, "access", { blockSuspended: true, blockExpired: true, graceDays: 0, blockDues: false, duesLimit: 0, hoursFrom: "", hoursTo: "", antiPassback: false });
    await enrol(admin, b, dev.id, "FP", true);
    const pin = (await db.member.findUniqueOrThrow({ where: { id: b } })).devicePin!;
    const day = addDays(today, -2);
    await punch(pin, day, "06:00:00");
    await punch(pin, day, "06:05:00");
    const logs = await db.accessLog.findMany({ where: { memberId: b }, orderBy: { at: "asc" } });
    expect(logs[1]!.result).toBe("ALLOWED");
    expect(logs[1]!.reason).toBe("Already inside");
    expect(await db.attendance.count({ where: { memberId: b } })).toBe(1);
    await putSetting(admin, "access", { blockSuspended: true, blockExpired: true, graceDays: 0, blockDues: false, duesLimit: 0, hoursFrom: "", hoursTo: "", antiPassback: true });
  });

  it("assigns an RFID card, pushes it, rejects bad and duplicate numbers, and clears it", async () => {
    await expect(assignCard(admin, lapsed, "12ab")).rejects.toThrow(/digits/);
    const fresh = (await db.member.findMany({ where: { orgId: gym.org.id, devicePin: null, id: { not: lapsed } } }))[0];
    const target = fresh ?? (await db.member.findUniqueOrThrow({ where: { id: a } }));
    if (!fresh) await db.member.update({ where: { id: a }, data: { devicePin: null } });
    await db.deviceUser.deleteMany({ where: { memberId: target.id } });
    await assignCard(admin, target.id, "0044123");
    const m = await db.member.findUniqueOrThrow({ where: { id: target.id } });
    expect(m.cardNo).toBe("0044123");
    expect(m.devicePin).toMatch(/^\d+$/);
    expect(await queued(`USERINFO PIN=${m.devicePin}\tName=${m.name}\tPri=0\tPasswd=\tCard=0044123`)).toBe(1);
    expect((await db.deviceUser.findFirstOrThrow({ where: { memberId: m.id } })).allowed).toBe(true);
    const other = [a, b].find((x) => x !== m.id)!;
    await expect(assignCard(admin, other, "0044123")).rejects.toThrow(/already assigned to/);
    const g2 = await makeGym();
    const admin2 = pick(await g2.user("Super Admin"), g2.a.id);
    const x = await createMember(admin2, { name: "Elsewhere", gender: "Male", phone: "9855510009", source: "Walk-in", tags: [] });
    await expect(assignCard(admin2, x.id, "0044123")).resolves.toBeTruthy();
    expect(await db.auditLog.count({ where: { orgId: gym.org.id, action: "member.rfid-card" } })).toBeGreaterThan(0);
    expect((await findForCheckIn(admin, "0044123")).map((h) => h.id)).toEqual([m.id]);
    await assignCard(admin, m.id, "");
    expect((await db.member.findUniqueOrThrow({ where: { id: m.id } })).cardNo).toBeNull();
    expect(await queued(`USERINFO PIN=${m.devicePin}\tName=${m.name}\tPri=0\tPasswd=\tCard=\tGrp`)).toBeGreaterThan(0);
    await assignCard(admin, m.id, "0044123");
    await eraseBiometrics(admin, m.id);
    expect((await db.member.findUniqueOrThrow({ where: { id: m.id } })).cardNo).toBeNull();
  });

  it("syncs every member to one device and refuses another gym", async () => {
    await assignCard(admin, b, "0055000");
    await assignCard(admin, a, "0066000");
    await db.member.update({ where: { id: lapsed }, data: { devicePin: "9001" } });
    const r = await syncDevice(admin, dev.id);
    expect(r.commands).toBeGreaterThanOrEqual(3);
    const bm = await db.member.findUniqueOrThrow({ where: { id: b } });
    const lines = (await db.deviceCommand.findMany({ where: { deviceId: dev.id, status: "PENDING" } })).map((c) => c.command);
    expect(lines.some((l) => l.startsWith(`DATA UPDATE USERINFO PIN=${bm.devicePin}`) && l.includes("Card=0055000"))).toBe(true);
    expect(lines).toContain("DATA DELETE USERINFO PIN=9001");
    expect(await db.auditLog.count({ where: { orgId: gym.org.id, action: "device.sync" } })).toBe(1);
    const g2 = await makeGym();
    const stranger = pick(await g2.user("Super Admin"), g2.a.id);
    await expect(syncDevice(stranger, dev.id)).rejects.toThrow(/Device not found/);
  });

  it("tests a scan without touching attendance", async () => {
    const before = await db.attendance.count({ where: { memberId: lapsed } });
    const bad = await testScan(admin, lapsed);
    expect(bad.allowed).toBe(false);
    const log = await db.accessLog.findFirstOrThrow({ where: { memberId: lapsed, method: "Test" } });
    expect(log.result).toBe("DENIED");
    expect(await db.attendance.count({ where: { memberId: lapsed } })).toBe(before);
    const good = await testScan(admin, b);
    expect(good.allowed).toBe(true);
    expect((await db.accessLog.findFirstOrThrow({ where: { memberId: b, method: "Test" } })).reason).toMatch(/^Test scan by/);
    const none = await createMember(admin, { name: "Nina None", gender: "Female", phone: "9855510010", source: "Walk-in", tags: [] });
    await expect(testScan(admin, none.id)).rejects.toThrow(/not on any device/);
  });

  it("refuses to open the door of a device that is offline, and logs an online opening as High severity with the device name", async () => {
    await db.device.update({ where: { id: dev.id }, data: { lastSeenAt: null } });
    await expect(openDoor(admin, dev.id)).rejects.toThrow(/Front door is offline \(never called in\), so the door cannot be opened from here/);
    await db.device.update({ where: { id: dev.id }, data: { lastSeenAt: new Date(Date.now() - 10 * 60_000) } });
    await expect(openDoor(admin, dev.id)).rejects.toThrow(/is offline \(last seen .*\), so the door/);
    expect(await db.accessLog.count({ where: { deviceId: dev.id, method: "Remote" } })).toBe(0);

    await db.device.update({ where: { id: dev.id }, data: { lastSeenAt: new Date() } });
    await openDoor(admin, dev.id);
    const l = await db.accessLog.findFirstOrThrow({ where: { deviceId: dev.id, method: "Remote" } });
    expect(l.memberId).toBeNull();
    expect(l.reason).toContain(admin.name);
    const a = await db.auditLog.findFirstOrThrow({ where: { orgId: admin.orgId, action: "device.open-door", entityId: dev.id }, orderBy: { id: "desc" } });
    expect((a.after as { name: string }).name).toBe("Front door");
    expect(severityOf(a.action, a.entity)).toBe("High");
    const c = await db.deviceCommand.findFirstOrThrow({ where: { deviceId: dev.id, command: { contains: "CONTROL DEVICE 0101" } }, orderBy: { cmdNo: "desc" } });
    expect(c.expiresAt && c.expiresAt.getTime() - Date.now()).toBeGreaterThan(20_000);
    expect(c.expiresAt && c.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(30_000);
  });

  it("drops a door command the device did not collect within 30 seconds instead of sending it late", async () => {
    await db.deviceCommand.updateMany({ where: { deviceId: dev.id, status: "PENDING" }, data: { status: "DONE" } });
    await db.device.update({ where: { id: dev.id }, data: { lastSeenAt: new Date() } });
    await openDoor(admin, dev.id);
    const d = await db.device.findUniqueOrThrow({ where: { id: dev.id } });
    const late = await pendingCommands(d, new Date(Date.now() + 31_000));
    expect(late).toBe("OK");
    expect((await db.deviceCommand.findFirstOrThrow({ where: { deviceId: dev.id, command: { contains: "CONTROL DEVICE 0101" } }, orderBy: { cmdNo: "desc" } })).status).toBe("EXPIRED");

    await openDoor(admin, dev.id);
    const fresh = await pendingCommands(d);
    expect(fresh).toContain("CONTROL DEVICE 0101");
    await db.deviceCommand.updateMany({ where: { deviceId: dev.id, status: "SENT" }, data: { status: "DONE" } });
  });
});
