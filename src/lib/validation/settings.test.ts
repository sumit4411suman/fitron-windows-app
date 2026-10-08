import { describe, expect, it } from "vitest";
import { billingDetailsInput, reminderInput, renewalInput } from "./settings";

const base = { expiryDays: ["15", "0"], dedupDays: "3", dueEveryDays: "0", defaultMonths: "3", graceDays: "5", birthdays: "on" };

describe("reminderInput", () => {
  it("coerces the form and sorts the expiry days descending without repeats", () => {
    expect(reminderInput.parse(base)).toEqual({ expiryDays: [15, 0], dedupDays: 3, dueEveryDays: 0, defaultMonths: 3, graceDays: 5, birthdays: true });
    expect(reminderInput.parse({ ...base, expiryDays: ["0", "15", "7", "15"] }).expiryDays).toEqual([15, 7, 0]);
  });

  it("treats a single pill and no pills correctly, and a missing birthday box as off", () => {
    expect(reminderInput.parse({ ...base, expiryDays: "7" }).expiryDays).toEqual([7]);
    expect(reminderInput.parse({ dedupDays: "3", dueEveryDays: "0", defaultMonths: "3", graceDays: "5" })).toMatchObject({ expiryDays: [], birthdays: false });
  });

  it.each([
    ["expiryDays", "5"],
    ["defaultMonths", "0"],
    ["graceDays", "61"],
    ["dueEveryDays", "31"],
    ["dedupDays", "-1"],
    ["defaultMonths", "2.5"],
  ])("rejects %s = %s", (k, v) => {
    const r = reminderInput.safeParse({ ...base, [k]: v });
    expect(r.success).toBe(false);
    if (!r.success) expect(String(r.error.issues[0]!.path[0])).toBe(k);
  });
});

describe("renewalInput", () => {
  it("coerces the select and the checkboxes", () => {
    expect(renewalInput.parse({ remindDays: "14", whatsapp: "on", email: "on" })).toEqual({ remindDays: 14, whatsapp: true, email: true });
    expect(renewalInput.parse({ remindDays: "1" })).toEqual({ remindDays: 1, whatsapp: false, email: false });
  });

  it("only takes the listed days", () => {
    const r = renewalInput.safeParse({ remindDays: "5", whatsapp: "on" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]!.message).toBe("Pick 14, 7, 3 or 1 days.");
  });
});

describe("billingDetailsInput", () => {
  it("uppercases and checks the GSTIN, lowercases the email, trims the rest", () => {
    expect(billingDetailsInput.parse({ legalName: "  Power Haus Fitness Pvt Ltd ", gstin: "20abcde1234f1z5", billingEmail: " Accounts@PowerHaus.in ", address: " C-7, Sector 4 " })).toEqual({
      legalName: "Power Haus Fitness Pvt Ltd",
      gstin: "20ABCDE1234F1Z5",
      billingEmail: "accounts@powerhaus.in",
      address: "C-7, Sector 4",
    });
  });

  it("accepts blank fields and rejects a bad GSTIN or email", () => {
    expect(billingDetailsInput.parse({ legalName: "", gstin: "", billingEmail: "", address: "" })).toEqual({});
    const g = billingDetailsInput.safeParse({ gstin: "123" });
    expect(g.success).toBe(false);
    if (!g.success) expect(g.error.issues[0]!.message).toBe("That isn't a valid GSTIN.");
    const e = billingDetailsInput.safeParse({ billingEmail: "not-an-email" });
    expect(e.success).toBe(false);
    if (!e.success) expect(e.error.issues[0]!.message).toBe("Enter a valid email.");
  });
});
