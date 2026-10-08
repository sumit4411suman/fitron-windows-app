/**
 * Settings › Go live: the checklist a gym completes before running on Fitron for real
 * (prototype `out.gl`). Pure: the service gathers the facts, this turns them into rows.
 */

export type Standing = { kind: "CUSTOM" } | { kind: "TRIAL"; daysLeft: number } | { kind: "PAID"; until: string } | { kind: "GRACE"; readOnlyFrom: string } | { kind: "LAPSED" };

export type CheckInput = {
  gym: { name: string; address?: string; city?: string; phone?: string; email?: string; logoKey?: string | null };
  tax: { enabled: boolean; rate: number };
  invoicePrefix: string;
  branches: { name: string; gstin: string | null }[];
  activePlans: number;
  staff: number;
  /** The plan opens Staff (else the button leads to the plans). */
  staffHref: string;
  wa: { mode: "demo" | "connector" | "cloud"; ok: boolean; text: string };
  autopay: { mode: "demo" | "live"; ready: boolean };
  devices: { total: number; online: number; planName: string | null; href: string };
  privacy: { officer?: string; email?: string };
  /** Whole days since the last backup, or null when there is none. */
  backupAgeDays: number | null;
  backupHref: string;
  idleMinutes: number;
  plan: { name: string; standing: Standing };
  demo: boolean;
  demoMembers: number;
};

export type Item = {
  key: string;
  label: string;
  ok: boolean;
  /** Recommended (the prototype's `warn`); everything else is required before going live. */
  recommended: boolean;
  detail: string;
  button: { label: string; href: string; danger?: boolean } | null;
};

export const DEMO_GYM_NAME = "Power Haus Gym";
export const isDemoGymName = (name: string) => /^power haus gym(\s*\(demo\))?$/i.test(name.trim());
const EMAIL = /^\S+@\S+\.\S+$/;
export const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function checklist(i: CheckInput): { items: Item[]; done: number; total: number; pct: number; ready: boolean; summary: string } {
  const name = i.gym.name.trim();
  const demoName = !name || isDemoGymName(name);
  const profileOk = !demoName && !!i.gym.address?.trim() && !!i.gym.phone?.trim() && EMAIL.test(i.gym.email ?? "");
  const withGstin = i.branches.filter((b) => GSTIN.test(b.gstin ?? ""));
  const missing = i.branches.filter((b) => !GSTIN.test(b.gstin ?? ""));
  const prefix = i.invoicePrefix.trim();
  const gstOk = !!prefix && (!i.tax.enabled || (i.branches.length > 0 && missing.length === 0));
  const gstDetail = i.tax.enabled
    ? missing.length
      ? `GST ${i.tax.rate}% · GSTIN missing on ${missing.map((b) => b.name).join(", ")}`
      : i.branches.length === 1
        ? `GST ${i.tax.rate}% · GSTIN ${withGstin[0]!.gstin}`
        : `GST ${i.tax.rate}% · GSTIN on ${withGstin.length} of ${i.branches.length} branches`
    : `GST off · ${prefix ? `invoice prefix ${prefix}` : "invoice prefix missing"}`;
  const waOk = i.wa.mode !== "demo" && i.wa.ok;
  const waDetail =
    i.wa.mode === "demo"
      ? "Demo mode: messages are logged in Fitron and not sent"
      : i.wa.mode === "connector"
        ? i.wa.ok
          ? "Linked device connected"
          : "Linked mode chosen but no device linked"
        : i.wa.text;
  const live = i.autopay.mode === "live";
  const privacyOk = !!i.privacy.officer?.trim() && EMAIL.test(i.privacy.email ?? "");
  const backupOk = i.backupAgeDays !== null && i.backupAgeDays <= 7;
  const backupDetail = i.backupAgeDays === null ? "No backup yet" : i.backupAgeDays === 0 ? "Last backup today" : `Last backup ${plural(i.backupAgeDays, "day")} ago`;
  const s = i.plan.standing;
  const subDetail =
    s.kind === "PAID"
      ? `${i.plan.name} plan · till ${s.until}`
      : s.kind === "CUSTOM"
        ? `${i.plan.name} plan · set up by FITRON`
        : s.kind === "TRIAL"
          ? `Free trial · ${plural(s.daysLeft, "day")} left`
          : s.kind === "GRACE"
            ? `Plan ended · renew before ${s.readOnlyFrom}`
            : "Locked — pay to continue";

  const items: Item[] = [
    {
      key: "profile",
      label: "Gym profile complete",
      ok: profileOk,
      recommended: false,
      detail: profileOk ? (i.gym.city?.trim() ? `${name} · ${i.gym.city.trim()}` : name) : demoName ? "Still using the demo gym name and details" : "Add the gym's address, phone and email",
      button: { label: "Edit profile", href: "/settings" },
    },
    {
      key: "logo",
      label: "Gym logo uploaded",
      ok: !!i.gym.logoKey,
      recommended: true,
      detail: i.gym.logoKey ? "Prints on invoices and receipts" : "Invoices show a monogram until you upload one",
      button: { label: "Upload logo", href: "/settings" },
    },
    { key: "gst", label: "Billing & GST set", ok: gstOk, recommended: false, detail: gstDetail, button: { label: "Billing settings", href: "/settings?tab=billing" } },
    { key: "plans", label: "Membership plans", ok: i.activePlans > 0, recommended: false, detail: `${plural(i.activePlans, "active plan")}`, button: { label: "Manage plans", href: "/plans" } },
    { key: "staff", label: "Staff accounts created", ok: i.staff > 0, recommended: true, detail: `${i.staff} staff with roles and passwords`, button: { label: "Add staff", href: i.staffHref } },
    { key: "wa", label: "WhatsApp sending set up", ok: waOk, recommended: true, detail: waDetail, button: { label: "WhatsApp settings", href: "/settings?tab=wa" } },
    {
      key: "autopay",
      label: "UPI autopay mode chosen",
      ok: live ? i.autopay.ready : true,
      recommended: !live,
      detail: live ? (i.autopay.ready ? "Live via Razorpay · keys set on the server" : "Live mode selected but Razorpay keys are not set on the server") : "Demo mode — switch to Live to collect real recurring UPI",
      button: { label: "Integrations", href: "/settings?tab=int" },
    },
    {
      key: "device",
      label: "Check-in device connected",
      ok: i.devices.online > 0,
      recommended: true,
      detail: i.devices.planName
        ? `Biometric & doors is on the ${i.devices.planName} plan`
        : i.devices.total
          ? `${i.devices.online} of ${plural(i.devices.total, "device")} online`
          : "No biometric or QR device yet — front-desk check-in works without one",
      button: i.devices.planName ? { label: "Plan & billing", href: i.devices.href } : { label: "Devices", href: i.devices.href },
    },
    {
      key: "privacy",
      label: "Privacy & DPDP details",
      ok: privacyOk,
      recommended: false,
      detail: privacyOk ? `Grievance officer: ${i.privacy.officer!.trim()}` : "Grievance officer name and email are required under DPDP",
      button: { label: "Privacy settings", href: "/settings?tab=privacy" },
    },
    { key: "backup", label: "Recent backup downloaded", ok: backupOk, recommended: false, detail: backupDetail, button: { label: "Backup now", href: i.backupHref } },
    {
      key: "idle",
      label: "Idle sign-out enabled",
      ok: i.idleMinutes > 0,
      recommended: true,
      detail: i.idleMinutes > 0 ? `Signs staff out after ${i.idleMinutes} minutes idle` : "Idle sign-out is off",
      button: { label: "Security", href: "#security" },
    },
    {
      key: "subscription",
      label: "Fitron subscription active",
      ok: s.kind === "PAID" || s.kind === "CUSTOM",
      recommended: s.kind === "TRIAL",
      detail: subDetail,
      button: { label: "Plan & billing", href: "/settings/billing" },
    },
    {
      key: "demo",
      label: "Demo data cleared",
      ok: !i.demo,
      recommended: false,
      detail: i.demo ? `${plural(i.demoMembers, "demo member")} and their money records are still in the system · this gym was created from FITRON's demo seed, so everything in it is demo data` : "Running on your own data",
      button: i.demo ? { label: "Clear demo data", href: "/settings/go-live?clear=1", danger: true } : null,
    },
  ];
  const done = items.filter((x) => x.ok).length;
  const total = items.length;
  const left = items.filter((x) => !x.ok && !x.recommended).length;
  return {
    items,
    done,
    total,
    pct: Math.round((done / total) * 100),
    ready: left === 0,
    summary: left === 0 ? "All required items done — you are ready to go live" : `${left} required ${left === 1 ? "item" : "items"} left before going live`,
  };
}
