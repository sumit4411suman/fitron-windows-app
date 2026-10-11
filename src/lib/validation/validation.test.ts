import { describe, expect, it } from "vitest";
import { indianPhone, rupees } from "./common";
import { memberInput } from "./member";
import { offerInput, planInput } from "./plan";
import { couponInput } from "./coupon";
import { todayIso } from "@/lib/services/time";
import { cookieNoticeInput, gymInput, privacyOfficerInput, taxInput } from "./settings";

describe("indianPhone", () => {
  it.each([
    ["9876543210", "9876543210"],
    ["98765 43210", "9876543210"],
    ["+91 98765-43210", "9876543210"],
    ["09876543210", "9876543210"],
  ])("normalises %s", (input, out) => {
    expect(indianPhone.parse(input)).toBe(out);
  });

  it.each(["12345", "5876543210", "98765432100"])("rejects %s", (input) => {
    expect(indianPhone.safeParse(input).success).toBe(false);
  });
});

describe("rupees", () => {
  it("turns rupee text into paise", () => {
    expect(rupees.parse("1,499")).toBe(149900);
    expect(rupees.parse("₹ 1499.5")).toBe(149950);
    expect(rupees.safeParse("abc").success).toBe(false);
    expect(rupees.safeParse("1.234").success).toBe(false);
  });
});

describe("memberInput", () => {
  const base = { name: "Priya Sharma", gender: "Female", phone: "9876543210", source: "Walk-in" };

  it("accepts the minimum and turns blanks into undefined", () => {
    const m = memberInput.parse({ ...base, email: "", dob: "", pin: "", whatsapp: "", tags: "" });
    expect(m).toMatchObject({ name: "Priya Sharma", phone: "9876543210", tags: [] });
    expect(m.email).toBeUndefined();
    expect(m.dob).toBeUndefined();
  });

  it("splits tags and checks PIN codes", () => {
    expect(memberInput.parse({ ...base, tags: "morning, pt ,," }).tags).toEqual(["morning", "pt"]);
    expect(memberInput.safeParse({ ...base, pin: "8270" }).success).toBe(false);
  });
});

describe("planInput", () => {
  it("parses prices in rupees and the GST checkbox", () => {
    const p = planInput.parse({ name: "Quarterly", kind: "Membership", months: "3", price: "4,000", regFee: "", discount: "", gstApplicable: "on", features: "Locker\n\nDiet chart" });
    expect(p).toMatchObject({ months: 3, price: 400000, regFee: 0, discount: 0, gstApplicable: true, features: ["Locker", "Diet chart"] });
    expect(planInput.parse({ name: "X Plan", kind: "Membership", months: "1", price: "1" }).gstApplicable).toBe(false);
  });
});

describe("offerInput", () => {
  it("refuses an end date in the past and accepts today", () => {
    const base = { code: "diwali 25", description: "", type: "PERCENT", value: "10", usageLimit: "" };
    const past = offerInput.safeParse({ ...base, validTill: "2020-01-01" });
    expect(past.success).toBe(false);
    expect(past.success ? "" : past.error.issues[0]?.message).toBe("The end date is in the past.");
    expect(past.success ? [] : past.error.issues[0]?.path).toEqual(["validTill"]);
    const ok = offerInput.parse({ ...base, validTill: todayIso() });
    expect(ok).toMatchObject({ code: "DIWALI25", value: 10, usageLimit: null });
  });
});

describe("couponInput", () => {
  it("refuses an end date in the past but allows no end date", () => {
    const base = { code: "WELCOME99", percentOff: "10", payRupees: "", appliesTo: "ALL", usageLimit: "" };
    expect(couponInput.safeParse({ ...base, validTill: "2020-01-01" }).success).toBe(false);
    expect(couponInput.parse({ ...base, validTill: "" }).validTill).toBeNull();
    expect(couponInput.parse({ ...base, validTill: todayIso() }).validTill).toBe(todayIso());
  });
});

describe("gymInput", () => {
  const all = { name: "Power Haus Gym", tagline: "Built Stronger", address: "C-7, Sector 4, City Centre, Bokaro", state: "Jharkhand", phone: "7319742490", email: "hello@powerhausgym.in", website: "powerhausgym.in", instagram: "@powerhausbokaro" };

  it("accepts the eight profile fields and turns blanks into undefined", () => {
    expect(gymInput.parse(all)).toEqual(all);
    const g = gymInput.parse({ name: "Ironworks", tagline: "", address: "", state: "", phone: "", email: "", website: "", instagram: "" });
    expect(g).toEqual({ name: "Ironworks" });
  });

  it("normalises the website and Instagram handle", () => {
    expect(gymInput.parse({ ...all, website: "https://www.powerhausgym.in/" }).website).toBe("www.powerhausgym.in");
    expect(gymInput.parse({ ...all, instagram: "instagram.com/powerhausbokaro" }).instagram).toBe("@powerhausbokaro");
    expect(gymInput.parse({ ...all, instagram: "https://instagram.com/powerhausbokaro/" }).instagram).toBe("@powerhausbokaro");
    expect(gymInput.parse({ ...all, instagram: "powerhausbokaro" }).instagram).toBe("@powerhausbokaro");
    expect(gymInput.parse({ ...all, phone: "+91 73197 42490" }).phone).toBe("7319742490");
  });

  it("rejects a bad email, phone, website or handle", () => {
    expect(gymInput.safeParse({ ...all, email: "nope" }).success).toBe(false);
    expect(gymInput.safeParse({ ...all, phone: "123" }).success).toBe(false);
    expect(gymInput.safeParse({ ...all, website: "powerhaus" }).success).toBe(false);
    expect(gymInput.safeParse({ ...all, instagram: "power haus" }).success).toBe(false);
    expect(gymInput.safeParse({ ...all, name: "P" }).success).toBe(false);
  });
});

describe("taxInput", () => {
  const base = { enabled: "on", rate: "18", type: "CGST+SGST", gstin: "20abcde1234f1z5", sac: "999723", invoicePrefix: "inv-" };

  it("upper-cases the GSTIN and the invoice prefix", () => {
    expect(taxInput.parse(base)).toEqual({ enabled: true, rate: 18, type: "CGST+SGST", gstin: "20ABCDE1234F1Z5", sac: "999723", invoicePrefix: "INV-" });
  });

  it("needs a valid GSTIN to charge GST, but not when GST is off", () => {
    expect(taxInput.safeParse({ ...base, gstin: "20ABCDE1234F1Z" }).success).toBe(false);
    const r = taxInput.safeParse({ ...base, gstin: "" });
    expect(r.success).toBe(false);
    expect(r.success ? [] : r.error.issues.map((i) => [i.path[0], i.message])).toEqual([["gstin", "Add your GSTIN to charge GST."]]);
    const off = taxInput.parse({ ...base, enabled: undefined, gstin: "" });
    expect(off.enabled).toBe(false);
    expect(off.gstin).toBeUndefined();
  });

  it("checks the SAC code and the prefix characters", () => {
    expect(taxInput.safeParse({ ...base, sac: "12" }).success).toBe(false);
    expect(taxInput.safeParse({ ...base, invoicePrefix: "IN V" }).success).toBe(false);
    expect(taxInput.parse({ ...base, sac: "" }).sac).toBeUndefined();
  });
});

describe("privacyOfficerInput", () => {
  it("accepts blanks and defaults retention to 24 months", () => {
    expect(privacyOfficerInput.parse({ officer: "", email: "", phone: "", retainMonths: "" })).toEqual({ officer: undefined, email: undefined, phone: undefined, retainMonths: 24 });
  });
  it("coerces and bounds the retention months", () => {
    expect(privacyOfficerInput.parse({ officer: " Asha Rao ", email: "Privacy@Gym.in", phone: "98765 43210", retainMonths: "12" })).toEqual({ officer: "Asha Rao", email: "privacy@gym.in", phone: "9876543210", retainMonths: 12 });
    expect(privacyOfficerInput.parse({ retainMonths: "0" }).retainMonths).toBe(0);
    expect(privacyOfficerInput.safeParse({ retainMonths: "121" }).success).toBe(false);
  });
  it("rejects a bad email and a 9-digit phone", () => {
    expect(privacyOfficerInput.safeParse({ email: "not-an-email" }).success).toBe(false);
    expect(privacyOfficerInput.safeParse({ phone: "987654321" }).success).toBe(false);
  });
});

describe("cookieNoticeInput", () => {
  it("needs at least a sentence", () => {
    expect(cookieNoticeInput.safeParse({ cookieNotice: "short" }).success).toBe(false);
    expect(cookieNoticeInput.parse({ cookieNotice: "  We use essential storage only.  " }).cookieNotice).toBe("We use essential storage only.");
  });
});
