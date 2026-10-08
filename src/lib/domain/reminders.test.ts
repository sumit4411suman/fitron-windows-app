import { describe, expect, it } from "vitest";
import { DEFAULT_REMINDERS, EXPIRY_CHIPS, expiryChipLabel, expiryScheduleText, scheduledJobRows } from "./reminders";

const jobs = [
  { name: "members.risk", label: "Churn risk for every member" },
  { name: "attendance.close", label: "Check out visits left open on earlier days" },
  { name: "reminders.expiry", label: "Expiry reminders on WhatsApp" },
  { name: "reminders.dues", label: "Payment reminders on WhatsApp" },
  { name: "reminders.birthday", label: "Birthday wishes" },
  { name: "reminders.winback", label: "Win-back offers to members who stopped coming" },
  { name: "autopay", label: "UPI Autopay notices and demo debits" },
  { name: "leads.followup", label: "Lead follow-ups due" },
  { name: "devices.sync", label: "Load members onto door devices, remove expired ones" },
  { name: "billing.branches", label: "Extra-branch plan reminders" },
  { name: "whatsapp.refresh", label: "Delivery status from the linked phone" },
];
const at631 = new Date("2026-10-03T01:01:00Z"); // 6:31 am IST

describe("Settings › Reminders", () => {
  it("labels the expiry pills like the prototype", () => {
    expect(EXPIRY_CHIPS).toEqual([15, 7, 3, 1, 0]);
    expect([expiryChipLabel(15), expiryChipLabel(1), expiryChipLabel(0)]).toEqual(["15 days before", "1 day before", "On expiry"]);
  });

  it("words the expiry schedule from the days that are on", () => {
    expect(expiryScheduleText([15, 7, 3, 1, 0])).toBe("15 days, 7 days, 3 days and 1 day before, and on expiry");
    expect(expiryScheduleText([0, 7])).toBe("7 days before, and on expiry");
    expect(expiryScheduleText([3])).toBe("3 days before");
    expect(expiryScheduleText([0])).toBe("on expiry");
    expect(expiryScheduleText([])).toBe("off");
  });

  it("lists the reminder rows first, in a fixed order, then the other jobs in JOBS order", () => {
    const rows = scheduledJobRows({ ...DEFAULT_REMINDERS, expiryDays: [15, 7, 3, 1, 0], dueEveryDays: 5 }, { winbackOn: true, jobs, runs: [] });
    expect(rows.every((r) => r.k === "Every morning, about 6:30")).toBe(true);
    expect(rows.map((r) => r.v)).toEqual([
      "Expiry reminders on WhatsApp · 15 days, 7 days, 3 days and 1 day before, and on expiry · not run yet today",
      "Payment reminders on WhatsApp · every 5 days while a balance is overdue · not run yet today",
      "Birthday wishes · not run yet today",
      "Win-back offers to members who stopped coming · not run yet today",
      "UPI Autopay notices and demo debits · not run yet today",
      "Churn risk for every member · not run yet today",
      "Check out visits left open on earlier days · not run yet today",
      "Lead follow-ups due · not run yet today",
      "Load members onto door devices, remove expired ones · not run yet today",
      "Extra-branch plan reminders · not run yet today",
      "Delivery status from the linked phone · not run yet today",
    ]);
  });

  it("says off when a reminder is switched off", () => {
    const rows = scheduledJobRows({ ...DEFAULT_REMINDERS, expiryDays: [], dueEveryDays: 0, birthdays: false }, { winbackOn: false, jobs, runs: [] });
    expect(rows[0]!.v).toContain("Expiry reminders on WhatsApp · off");
    expect(rows[1]!.v).toContain("Payment reminders on WhatsApp · off");
    expect(rows[2]!.v).toContain("Birthday wishes (off)");
    expect(rows[3]!.v).toContain("Win-back offers to members who stopped coming (off)");
  });

  it("ends each row with today's run: time and result, the failure, or not run yet", () => {
    const rows = scheduledJobRows(DEFAULT_REMINDERS, {
      winbackOn: false,
      jobs,
      runs: [
        { name: "reminders.expiry", startedAt: at631, result: { sent: 3 }, error: null, finishedAt: at631 },
        { name: "reminders.dues", startedAt: at631, result: null, error: "boom", finishedAt: at631 },
        { name: "reminders.expiry", startedAt: new Date(at631.getTime() - 3_600_000), result: { sent: 0 }, error: null, finishedAt: at631 },
      ],
    });
    expect(rows[0]!.v).toMatch(/· ran 6:31 am, sent 3$/);
    expect(rows[1]!.v).toMatch(/· failed: boom$/);
    expect(rows[2]!.v).toMatch(/· not run yet today$/);
  });
});
