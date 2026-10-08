import { describe, expect, it } from "vitest";
import { DEFAULT_TEMPLATES, placeholders, REMINDER_KEYS, render, rupeesText, runLine, waNumber } from "./whatsapp";

describe("whatsapp templates", () => {
  it("fills variables and blanks unknown ones", () => {
    expect(render("Hi {{member_name}}, {{ amount }} {{nope}}.", { member_name: "Asha", amount: "4,720" })).toBe("Hi Asha, 4,720 .");
  });
  it("lists placeholders once, in order, for Cloud API parameters", () => {
    expect(placeholders("{{a}} {{b}} {{a}} {{ c }}")).toEqual(["a", "b", "c"]);
  });
  it("every default template only uses known variables", () => {
    const known = new Set(["member_name", "member_id", "plan_name", "start_date", "expiry_date", "amount", "pending_amount", "invoice_number", "gym_name", "link", "class_name", "class_time"]);
    for (const t of DEFAULT_TEMPLATES) for (const v of placeholders(t.body)) expect(known.has(v), `${t.key}: ${v}`).toBe(true);
  });
  it("has a 15-day expiry reminder ahead of the 7-day one, off until the pill is turned on, de-duplicated like the others", () => {
    expect(REMINDER_KEYS).toContain("exp15");
    const keys = DEFAULT_TEMPLATES.map((t) => t.key);
    expect(keys.indexOf("exp15")).toBe(keys.indexOf("exp7") - 1);
    expect(DEFAULT_TEMPLATES.find((t) => t.key === "exp15")).toMatchObject({ name: "Expiry reminder · 15 days", trigger: "15 days before expiry", autoSend: false });
  });
  it("normalises Indian mobiles", () => {
    expect(waNumber("98765 43210")).toBe("919876543210");
    expect(waNumber("+91-9876543210")).toBe("919876543210");
    expect(waNumber("09876543210")).toBe("919876543210");
    expect(waNumber("12345")).toBeNull();
    expect(waNumber("")).toBeNull();
  });
  it("formats rupees", () => {
    expect(rupeesText(472000)).toBe("4,720");
    expect(rupeesText(472050)).toBe("4,720.50");
  });
});

describe("runLine", () => {
  const fts = () => "3 Oct, 7:02 am";
  it("formats a run with skipped messages", () => {
    expect(runLine({ ts: "x", name: "All scheduled rules", sent: 4, skipped: 1 }, fts)).toBe("3 Oct, 7:02 am · All scheduled rules · 4 sent, 1 skipped");
  });
  it("omits skipped when zero", () => {
    expect(runLine({ ts: "x", name: "Expiry reminder · 7 days", sent: 2, skipped: 0 }, fts)).toBe("3 Oct, 7:02 am · Expiry reminder · 7 days · 2 sent");
  });
  it("renders legacy records without a name", () => {
    expect(runLine({ ts: "x", sent: 5 }, fts)).toBe("3 Oct, 7:02 am · All scheduled rules · 5 sent");
  });
});
