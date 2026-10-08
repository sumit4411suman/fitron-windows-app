import { describe, expect, it } from "vitest";
import { checklist, isDemoGymName, type CheckInput } from "./go-live";

const base: CheckInput = {
  gym: { name: "Iron Temple", address: "MG Road", city: "Ranchi", phone: "9876543210", email: "hi@irontemple.in", logoKey: "k" },
  tax: { enabled: false, rate: 18 },
  invoicePrefix: "INV-",
  branches: [{ name: "City Centre", gstin: "20ABCDE1234F1Z5" }],
  activePlans: 3,
  staff: 2,
  staffHref: "/staff",
  wa: { mode: "cloud", ok: true, text: "Connected as Iron Temple (+91 98765 43210), quality GREEN" },
  autopay: { mode: "live", ready: true },
  devices: { total: 1, online: 1, planName: null, href: "/settings/devices" },
  privacy: { officer: "Asha", email: "privacy@irontemple.in" },
  backupAgeDays: 1,
  backupHref: "/settings/backup",
  idleMinutes: 30,
  plan: { name: "Professional", standing: { kind: "PAID", until: "31 Dec 2026" } },
  demo: false,
  demoMembers: 0,
};
const item = (i: Partial<CheckInput>, key: string) => checklist({ ...base, ...i }).items.find((x) => x.key === key)!;

describe("go-live checklist", () => {
  it("lists the 13 prototype items in order", () => {
    expect(checklist(base).items.map((x) => x.label)).toEqual([
      "Gym profile complete",
      "Gym logo uploaded",
      "Billing & GST set",
      "Membership plans",
      "Staff accounts created",
      "WhatsApp sending set up",
      "UPI autopay mode chosen",
      "Check-in device connected",
      "Privacy & DPDP details",
      "Recent backup downloaded",
      "Idle sign-out enabled",
      "Fitron subscription active",
      "Demo data cleared",
    ]);
    expect(checklist(base).items.map((x) => x.button?.label)).toEqual(["Edit profile", "Upload logo", "Billing settings", "Manage plans", "Add staff", "WhatsApp settings", "Integrations", "Devices", "Privacy settings", "Backup now", "Security", "Plan & billing", undefined]);
  });

  it("gym profile: demo names and missing details are not ok", () => {
    expect(isDemoGymName("Power Haus Gym (demo)")).toBe(true);
    for (const name of ["Power Haus Gym", "power haus gym (demo)", ""]) {
      const x = item({ gym: { ...base.gym, name } }, "profile");
      expect(x.ok).toBe(false);
      expect(x.detail).toBe("Still using the demo gym name and details");
    }
    expect(item({ gym: { ...base.gym, email: "nope" } }, "profile").detail).toBe("Add the gym's address, phone and email");
    expect(item({}, "profile")).toMatchObject({ ok: true, detail: "Iron Temple · Ranchi" });
    expect(item({ gym: { ...base.gym, city: "" } }, "profile").detail).toBe("Iron Temple");
  });

  it("billing & GST", () => {
    expect(item({}, "gst")).toMatchObject({ ok: true, detail: "GST off · invoice prefix INV-" });
    const on = item({ tax: { enabled: true, rate: 18 }, branches: [{ name: "City Centre", gstin: "20ABCDE1234F1Z5" }, { name: "Chas", gstin: null }] }, "gst");
    expect(on).toMatchObject({ ok: false, detail: "GST 18% · GSTIN missing on Chas" });
    expect(item({ tax: { enabled: true, rate: 18 }, branches: [{ name: "Chas", gstin: "bad" }] }, "gst").ok).toBe(false);
    expect(item({ tax: { enabled: true, rate: 18 } }, "gst")).toMatchObject({ ok: true, detail: "GST 18% · GSTIN 20ABCDE1234F1Z5" });
    expect(item({ invoicePrefix: "" }, "gst")).toMatchObject({ ok: false, detail: "GST off · invoice prefix missing" });
  });

  it("autopay: live needs keys, demo is only recommended", () => {
    expect(item({ autopay: { mode: "live", ready: false } }, "autopay")).toMatchObject({ ok: false, recommended: false });
    expect(item({ autopay: { mode: "demo", ready: false } }, "autopay")).toMatchObject({ ok: true, recommended: true, detail: "Demo mode — switch to Live to collect real recurring UPI" });
  });

  it("subscription standings", () => {
    const sub = (standing: CheckInput["plan"]["standing"]) => item({ plan: { name: "Professional", standing } }, "subscription");
    expect(sub({ kind: "CUSTOM" })).toMatchObject({ ok: true, detail: "Professional plan · set up by FITRON" });
    expect(sub({ kind: "PAID", until: "31 Dec 2026" })).toMatchObject({ ok: true, detail: "Professional plan · till 31 Dec 2026" });
    expect(sub({ kind: "TRIAL", daysLeft: 5 })).toMatchObject({ ok: false, recommended: true, detail: "Free trial · 5 days left" });
    expect(sub({ kind: "GRACE", readOnlyFrom: "12 Oct 2026" })).toMatchObject({ ok: false, recommended: false, detail: "Plan ended · renew before 12 Oct 2026" });
    expect(sub({ kind: "LAPSED" })).toMatchObject({ ok: false, recommended: false, detail: "Locked — pay to continue" });
  });

  it("backup age", () => {
    expect(item({ backupAgeDays: 7 }, "backup").ok).toBe(true);
    expect(item({ backupAgeDays: 8 }, "backup").ok).toBe(false);
    expect(item({ backupAgeDays: null }, "backup")).toMatchObject({ ok: false, detail: "No backup yet" });
    expect(item({ backupAgeDays: 1 }, "backup").detail).toBe("Last backup 1 day ago");
    expect(item({ backupAgeDays: 2 }, "backup").detail).toBe("Last backup 2 days ago");
    expect(item({ backupAgeDays: 0 }, "backup").detail).toBe("Last backup today");
  });

  it("idle sign-out and demo data", () => {
    expect(item({ idleMinutes: 0 }, "idle")).toMatchObject({ ok: false, detail: "Idle sign-out is off" });
    expect(item({}, "idle").detail).toBe("Signs staff out after 30 minutes idle");
    const demo = item({ demo: true, demoMembers: 48 }, "demo");
    expect(demo.ok).toBe(false);
    expect(demo.detail).toContain("48 demo members");
    expect(demo.detail).toContain("created from FITRON's demo seed");
    expect(demo.button).toMatchObject({ label: "Clear demo data", danger: true });
    expect(item({}, "demo").button).toBeNull();
  });

  it("progress and summary", () => {
    const all = checklist(base);
    expect(all).toMatchObject({ done: 13, total: 13, pct: 100, ready: true, summary: "All required items done — you are ready to go live" });
    const one = checklist({ ...base, demo: true, idleMinutes: 0 });
    expect(one).toMatchObject({ done: 11, ready: false, summary: "1 required item left before going live" });
    const two = checklist({ ...base, demo: true, activePlans: 0, staff: 0 });
    expect(two).toMatchObject({ ready: false, summary: "2 required items left before going live" });
    expect(checklist({ ...base, staff: 0, idleMinutes: 0 }).ready).toBe(true);
  });
});
