import { afterEach, describe, expect, it, vi } from "vitest";
import { FAQ, ackText, appVersion, deviceLabel, supportContacts, systemDetailsText, ticketEmail } from "./support";
import { ticketInput } from "../validation/support";

afterEach(() => vi.unstubAllEnvs());

describe("deviceLabel", () => {
  it("follows the prototype rule", () => {
    expect(deviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 17) Safari")).toBe("Safari · iOS");
    expect(deviceLabel("Mozilla/5.0 (Linux; Android 14) Chrome/120")).toBe("Chrome · Android");
    expect(deviceLabel("Mozilla/5.0 (Windows NT 10) Chrome/120 Safari/537 Edg/120")).toBe("Edge · Windows");
    expect(deviceLabel("Mozilla/5.0 (X11; Linux) Chrome/120 Safari/537")).toBe("Chrome · Desktop");
    expect(deviceLabel(null)).toBe("Browser");
    expect(deviceLabel("")).toBe("Browser");
  });
});

describe("appVersion", () => {
  it("adds the commit when known", () => {
    vi.stubEnv("APP_VERSION", "0.1.0");
    vi.stubEnv("APP_COMMIT", "ac00526");
    expect(appVersion()).toBe("0.1.0 (ac00526)");
    vi.stubEnv("APP_COMMIT", "");
    expect(appVersion()).toBe("0.1.0");
    vi.stubEnv("APP_VERSION", "");
    expect(appVersion()).toBe("dev");
  });
});

describe("tickets", () => {
  it("words the acknowledgement", () => {
    expect(ackText("TKT-1001", "Normal")).toBe("Thanks, we've got your request TKT-1001. We reply within 4 working hours.");
    expect(ackText("TKT-1001", "Urgent")).toMatch(/within 4 working hours; urgent tickets are picked up first\.$/);
  });
  const t = { number: "TKT-1001", priority: "Urgent", subject: "Invoice PDF not downloading", gymName: "Power Haus Gym", orgId: "o1", by: { name: "Sumit", email: "s@x.in", role: "Super Admin" }, branch: null, topic: "Billing & plan", appVersion: "0.1.0", browser: "Chrome · Desktop", ip: null, message: "It is blank." };
  it("builds the email", () => {
    const m = ticketEmail(t);
    expect(m.subject).toBe("[TKT-1001] [Urgent] Invoice PDF not downloading — Power Haus Gym");
    expect(ticketEmail({ ...t, priority: "Normal" }).subject).toBe("[TKT-1001] Invoice PDF not downloading — Power Haus Gym");
    for (const l of ["Gym: Power Haus Gym (org o1)", "Raised by: Sumit <s@x.in> · Super Admin", "Branch: All branches", "Topic: Billing & plan", "Priority: Urgent", "App version: 0.1.0", "Browser: Chrome · Desktop", "IP: —", "It is blank.", "Reference: TKT-1001"]) expect(m.text).toContain(l);
  });
  it("validates input", () => {
    const ok = { topic: "Question", priority: "Normal", subject: "  Invoice PDF  ", message: "  The PDF is blank here.  " };
    expect(ticketInput.parse(ok)).toMatchObject({ subject: "Invoice PDF", message: "The PDF is blank here." });
    expect(ticketInput.safeParse({ ...ok, subject: "abc" }).error?.issues[0]?.message).toBe("Add a short subject.");
    expect(ticketInput.safeParse({ ...ok, message: "123456789" }).error?.issues[0]?.message).toBe("Describe the problem in a sentence or two.");
    expect(ticketInput.safeParse({ ...ok, topic: "Nope" }).success).toBe(false);
    expect(ticketInput.safeParse({ ...ok, priority: "High" }).success).toBe(false);
  });
});

describe("supportContacts", () => {
  it("shows Email and Website by default", () => {
    const c = supportContacts({ gymName: "Power Haus" });
    expect(c.map((x) => x.label)).toEqual(["Email", "Website"]);
    expect(c[0]!.href).toContain(encodeURIComponent("Power Haus"));
    expect(c[1]!.value).toBe("fitron.in");
  });
  it("adds WhatsApp and Call when configured", () => {
    const c = supportContacts({ gymName: "G", whatsapp: "9876543210", phone: "9123456789" });
    expect(c.map((x) => x.label)).toEqual(["Email", "WhatsApp", "Call", "Website"]);
    expect(c[1]!.href.startsWith("https://wa.me/919876543210?text=")).toBe(true);
    expect(c[2]!.href).toBe("tel:+919123456789");
  });
});

describe("FAQ and system details", () => {
  it("lists eight questions with real branch prices", () => {
    expect(FAQ).toHaveLength(8);
    expect(FAQ[0]!.q).toBe("How do I add a new member?");
    expect(FAQ[7]!.q).toBe("Is my data backed up?");
    expect(FAQ[6]!.a).toContain("₹499/month");
    expect(FAQ[6]!.a).toContain("₹4,990/year");
  });
  it("joins the copy text", () => {
    expect(systemDetailsText([{ k: "Gym", v: "G" }, { k: "Plan", v: "Pro" }], "2026-10-04 10:00")).toBe("Gym G\nPlan Pro\nDate 2026-10-04 10:00");
  });
});

describe("priority-support plans", () => {
  it("adds nothing to a normal ticket's acknowledgement and subject", () => {
    expect(ackText("TKT-1001", "Normal")).toBe("Thanks, we've got your request TKT-1001. We reply within 4 working hours.");
    expect(ackText("TKT-1001", "Urgent")).toBe("Thanks, we've got your request TKT-1001. We reply within 4 working hours; urgent tickets are picked up first.");
  });

  it("tells a priority plan its ticket is picked up first, urgent or not", () => {
    expect(ackText("TKT-1002", "Normal", true)).toBe("Thanks, we've got your request TKT-1002. We reply within 4 working hours; tickets on priority-support plans are picked up first.");
    expect(ackText("TKT-1002", "Urgent", true)).toContain("urgent tickets and tickets on priority-support plans are picked up first");
  });

  const base = { number: "TKT-1003", priority: "Normal", subject: "Reports are slow", gymName: "Power Haus", orgId: "org1", by: { name: "Asha", email: "a@x.in", role: "Super Admin" }, branch: null, topic: "Question", appVersion: "1", browser: "Chrome", ip: null, message: "Hi" };

  it("marks the support email of a priority plan so the team sees it first", () => {
    const m = ticketEmail({ ...base, plan: { name: "Enterprise", prioritySupport: true } });
    expect(m.subject).toBe("[TKT-1003] [PRIORITY PLAN] Reports are slow — Power Haus");
    expect(m.text).toContain("Plan: Enterprise (priority support: answer first)");
    expect(ticketEmail({ ...base, priority: "Urgent", plan: { name: "Enterprise", prioritySupport: true } }).subject).toBe("[TKT-1003] [PRIORITY PLAN] [Urgent] Reports are slow — Power Haus");
  });

  it("names the plan on other tickets without marking them", () => {
    const m = ticketEmail({ ...base, plan: { name: "Starter", prioritySupport: false } });
    expect(m.subject).toBe("[TKT-1003] Reports are slow — Power Haus");
    expect(m.text).toContain("Plan: Starter\n");
    expect(ticketEmail(base).subject).toBe("[TKT-1003] Reports are slow — Power Haus");
  });
});
