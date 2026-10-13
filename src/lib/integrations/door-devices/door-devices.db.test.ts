import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:net";
import { db } from "@/lib/db";
import { hasDb, makeGym, pick } from "@/test/db";
import { addDays } from "@/lib/domain/dates";
import { createMember } from "@/lib/services/members";
import { createPlan } from "@/lib/services/plans";
import { sellMembership } from "@/lib/services/billing";
import { assignCard, openDoor, saveDevice } from "@/lib/services/biometric";
import { todayIso } from "@/lib/services/time";
import { applyDeviceNetwork, onLocalNetwork, plainAddress, stopDeviceNetwork, syncAllDevices, thisComputersAddresses } from ".";

// FITRON for Windows: door devices on the gym's network reach this computer on the device port, and nothing else does.

describe("which addresses count as the gym's network", () => {
  it("takes private, link-local and this computer's addresses, and nothing on the internet", () => {
    for (const ip of ["10.0.0.7", "172.16.4.2", "172.31.255.1", "192.168.1.20", "169.254.3.3", "127.0.0.1"]) expect(onLocalNetwork(ip), ip).toBe(true);
    for (const ip of ["8.8.8.8", "172.32.0.1", "172.15.0.1", "192.169.1.1", "100.64.0.1", "", "::1", "192.168.1", "192.168.1.300"]) expect(onLocalNetwork(ip), ip).toBe(false);
    expect(plainAddress("::ffff:192.168.1.5")).toBe("192.168.1.5");
    expect(plainAddress(undefined)).toBe("");
  });

  it("lists this computer's addresses for the device, the real adapters first", () => {
    const nic = (address: string, o: { internal?: boolean; family?: "IPv4" | "IPv6" } = {}) => ({ address, netmask: "255.255.255.0", family: o.family ?? "IPv4", mac: "00:00:00:00:00:00", internal: o.internal ?? false, cidr: null }) as never;
    expect(
      thisComputersAddresses({
        "vEthernet (Default Switch)": [nic("172.20.48.1")],
        "Wi-Fi": [nic("192.168.1.20"), nic("fe80::1", { family: "IPv6" })],
        "Loopback Pseudo-Interface 1": [nic("127.0.0.1", { internal: true })],
        Ethernet: [nic("169.254.10.10")],
        Public: [nic("49.36.1.2")],
      }),
    ).toEqual([
      { name: "Wi-Fi", address: "192.168.1.20" },
      { name: "vEthernet (Default Switch)", address: "172.20.48.1" },
    ]);
  });
});

/** A port nobody uses on this computer right now. */
const freePort = () =>
  new Promise<number>((resolve) => {
    const s = createServer().listen(0, "127.0.0.1", () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => resolve(p));
    });
  });

/** The device clock's "now": India time. */
const deviceNow = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 19).replace("T", " ");

describe.skipIf(!hasDb)("the device port (database)", () => {
  let port = 0;
  let gym: Awaited<ReturnType<typeof makeGym>>;
  let admin: Awaited<ReturnType<Awaited<ReturnType<typeof makeGym>>["user"]>>;
  let planId = "";
  let active = "";
  let lapsed = "";
  const serial = `W${randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase()}`;
  const today = todayIso();
  const device = (path: string, body?: string) => fetch(`http://127.0.0.1:${port}${path}`, body === undefined ? {} : { method: "POST", body }).then(async (r) => ({ status: r.status, text: await r.text() }));
  const pinOf = async (id: string) => (await db.member.findUniqueOrThrow({ where: { id } })).devicePin!;

  beforeAll(async () => {
    gym = await makeGym();
    admin = pick(await gym.user("Super Admin"), gym.a.id);
    planId = (await createPlan(admin, { name: "Monthly", kind: "Membership", months: 1, price: 100000, regFee: 0, discount: 0, gstApplicable: false, features: [] })).id;
    active = (await createMember(admin, { name: "Asha Active", gender: "Female", phone: "9855510001", source: "Walk-in", tags: [] })).id;
    lapsed = (await createMember(admin, { name: "Lalit Lapsed", gender: "Male", phone: "9855510002", source: "Walk-in", tags: [] })).id;
    await sellMembership(admin, active, { planId, startDate: addDays(today, -5), discount: 0, includeRegFee: true, payAmount: 100000, payMethod: "Cash" as const });
    await sellMembership(admin, lapsed, { planId, startDate: addDays(today, -70), discount: 0, includeRegFee: true, payAmount: 100000, payMethod: "Cash" as const });
    port = await freePort();
    expect(await applyDeviceNetwork({ on: true, port, host: "127.0.0.1" })).toEqual({ listening: true, port, error: null });
  });

  afterAll(async () => {
    await stopDeviceNetwork();
  });

  it("answers a device's calls and nothing else of FITRON", async () => {
    const hello = await device(`/iclock/cdata?SN=${serial}&options=all&pushver=2.4.1`);
    expect(hello).toMatchObject({ status: 200 });
    expect(hello.text).toContain(`GET OPTION FROM: ${serial}`);
    // Recorded, with the address it called from, and held until a gym adds its serial.
    expect(await db.device.findUniqueOrThrow({ where: { serial } })).toMatchObject({ approved: false, ip: "127.0.0.1" });
    for (const path of ["/", "/login", "/dashboard", "/api/health", "/settings/devices", "/iclock", "/iclockx/cdata", "/_next/static/x.js"]) expect((await device(path)).status, path).toBe(404);
    expect((await fetch(`http://127.0.0.1:${port}/iclock/cdata?SN=${serial}`, { method: "PUT", body: "x" })).status).toBe(404);
    // Some firmware asks for ZKTeco's own .aspx addresses.
    expect((await device(`/iclock/getrequest.aspx?SN=${serial}`)).text).toBe("OK");
  });

  it("loads the members who may come in, lets them in and marks their attendance", async () => {
    await saveDevice(admin, { serial, name: "Main door", branchId: gym.a.id, relaySeconds: 5 });
    await assignCard(admin, active, "4100001");
    await assignCard(admin, lapsed, "4100002");
    const pin = await pinOf(active);
    const commands = (await device(`/iclock/getrequest?SN=${serial}`)).text;
    expect(commands).toContain(`DATA UPDATE USERINFO PIN=${pin}\tName=Asha Active`);
    expect(commands).toContain("Card=4100001");
    // A member whose plan ended is never loaded, so the door stays shut for them.
    expect(commands).not.toContain("Card=4100002");

    const r = await device(`/iclock/cdata?SN=${serial}&table=ATTLOG&Stamp=9999`, `${pin}\t${deviceNow()}\t0\t4\t0\t0\n`);
    expect(r).toEqual({ status: 200, text: "OK: 1" });
    const d = await db.device.findUniqueOrThrow({ where: { serial } });
    expect(await db.attendance.findFirstOrThrow({ where: { memberId: active, deviceId: d.id } })).toMatchObject({ method: "Card", checkOut: null });
    expect(await db.accessLog.findFirstOrThrow({ where: { deviceId: d.id, memberId: active } })).toMatchObject({ result: "ALLOWED", reason: "Door opened · check-in" });
  });

  it("takes a member off the devices when their plan has ended and puts them back when they renew", async () => {
    await syncAllDevices();
    const pin = await pinOf(lapsed);
    expect((await device(`/iclock/getrequest?SN=${serial}`)).text).toContain(`DATA DELETE USERINFO PIN=${pin}`);
    await sellMembership(admin, lapsed, { planId, startDate: today, discount: 0, includeRegFee: false, payAmount: 100000, payMethod: "Cash" as const });
    expect((await syncAllDevices()).changes).toBeGreaterThan(0);
    expect((await device(`/iclock/getrequest?SN=${serial}`)).text).toContain(`DATA UPDATE USERINFO PIN=${pin}\tName=Lalit Lapsed`);
  });

  it("opens the door from FITRON on the device's next call", async () => {
    const d = await db.device.findUniqueOrThrow({ where: { serial } });
    await openDoor(admin, d.id);
    const commands = (await device(`/iclock/getrequest?SN=${serial}`)).text;
    expect(commands).toMatch(/^C:\d+:CONTROL DEVICE 01010500$/m);
    const no = Number(commands.match(/^C:(\d+):CONTROL/m)![1]);
    expect((await device(`/iclock/devicecmd?SN=${serial}`, `ID=${no}&Return=0&CMD=CONTROL\n`)).text).toBe("OK");
    expect((await db.deviceCommand.findFirstOrThrow({ where: { deviceId: d.id, cmdNo: no } })).status).toBe("DONE");
  });

  it("says so when another program has the port, and stops listening when turned off", async () => {
    const taken = await freePort();
    const other: Server = await new Promise((resolve) => {
      const s = createServer().listen(taken, "127.0.0.1", () => resolve(s));
    });
    try {
      const r = await applyDeviceNetwork({ on: true, port: taken, host: "127.0.0.1" });
      expect(r.listening).toBe(false);
      expect(r.error).toMatch(new RegExp(`Another program on this computer already uses port ${taken}`));
    } finally {
      await new Promise((r) => other.close(r));
    }
    expect(await applyDeviceNetwork({ on: true, port, host: "127.0.0.1" })).toMatchObject({ listening: true, port });
    expect(await stopDeviceNetwork()).toEqual({ listening: false, port: null, error: null });
    await expect(device(`/iclock/getrequest?SN=${serial}`)).rejects.toThrow();
  });
});
