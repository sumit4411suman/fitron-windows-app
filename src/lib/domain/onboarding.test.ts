import { describe, expect, it } from "vitest";
import { PLAN_FEATURES } from "./features";
import { PLAN_SUGGEST, defaultForm, emptyPlan, emptyStaff, firstInvalid, planKind, planRows, reviewRows, staffRows, stepsFor, validateStep, type OnboardingForm, type StepKey } from "./onboarding";

const has = (plan: string) => (f: Parameters<Parameters<typeof stepsFor>[0]>[0]) => PLAN_FEATURES[plan]!.includes(f);
const form = (over: Partial<OnboardingForm> = {}): OnboardingForm => ({ ...defaultForm(), ...over });
const GSTIN_OK = "20ABCDE1234F1Z5";

describe("stepsFor", () => {
  it("shows all eight steps on a plan that opens everything", () => {
    expect(stepsFor(has("professional"))).toEqual(["tax", "branch", "plans", "staff", "whatsapp", "opening", "start", "review"]);
    expect(stepsFor(has("enterprise"))).toHaveLength(8);
  });
  it("leaves out what the plan doesn't open: Starter has no team, WhatsApp or accounts", () => {
    expect(stepsFor(has("starter"))).toEqual(["tax", "branch", "plans", "start", "review"]);
  });
});

describe("the starting form", () => {
  it("is what the suggestions say, and passes every step", () => {
    const f = defaultForm();
    expect(f.tax).toMatchObject({ gst: false, prefix: "INV-", start: "1001", rate: "18", type: "CGST+SGST" });
    expect(f.rows).toEqual(PLAN_SUGGEST);
    for (const k of stepsFor(has("professional"))) expect(validateStep(k, f)).toBeNull();
  });
  it("hands out copies, so one gym's edits never change the suggestions", () => {
    const a = defaultForm();
    a.rows[0]!.price = "1";
    expect(defaultForm().rows[0]!.price).toBe("1500");
  });
});

describe("Billing & GST", () => {
  it("asks for the GSTIN only when the gym charges GST, and accepts it in any case", () => {
    expect(validateStep("tax", form({ tax: { ...defaultForm().tax, gst: true } }))).toMatch(/GSTIN should be 15 characters/);
    expect(validateStep("tax", form({ tax: { ...defaultForm().tax, gst: true, gstin: GSTIN_OK.toLowerCase() } }))).toBeNull();
    expect(validateStep("tax", form({ tax: { ...defaultForm().tax, gst: false, gstin: "junk" } }))).toBeNull();
  });
  it("checks the rate, the prefix and the first number", () => {
    const t = defaultForm().tax;
    expect(validateStep("tax", form({ tax: { ...t, gst: true, gstin: GSTIN_OK, rate: "40" } }))).toMatch(/between 0 and 28/);
    expect(validateStep("tax", form({ tax: { ...t, prefix: "" } }))).toMatch(/Invoice prefix/);
    expect(validateStep("tax", form({ tax: { ...t, prefix: "bad prefix!" } }))).toMatch(/Invoice prefix/);
    expect(validateStep("tax", form({ tax: { ...t, prefix: "fit/24-" } }))).toBeNull();
    expect(validateStep("tax", form({ tax: { ...t, start: "0" } }))).toMatch(/1 or more/);
    expect(validateStep("tax", form({ tax: { ...t, start: "12.5" } }))).toMatch(/1 or more/);
    expect(validateStep("tax", form({ tax: { ...t, start: "99999999999" } }))).toMatch(/too large/);
    expect(validateStep("tax", form({ tax: { ...t, start: "5000" } }))).toBeNull();
  });
});

describe("Branch", () => {
  it("needs a short name and opening hours, within the limits Settings uses", () => {
    const b = defaultForm().branch;
    expect(validateStep("branch", form({ branch: { ...b, short: " " } }))).toMatch(/short name/);
    expect(validateStep("branch", form({ branch: { ...b, short: "x".repeat(31) } }))).toMatch(/30 characters/);
    expect(validateStep("branch", form({ branch: { ...b, hours: "" } }))).toMatch(/opening hours/);
    expect(validateStep("branch", form({ branch: { ...b, hours: "y".repeat(41) } }))).toMatch(/40 characters/);
    expect(validateStep("branch", form({ branch: { ...b, manager: "" } }))).toBeNull();
  });
});

describe("Plans", () => {
  const rows = (...r: Partial<ReturnType<typeof emptyPlan>>[]) => form({ rows: r.map((x) => ({ ...emptyPlan(), ...x })) });
  it("needs at least one plan, and ignores a blank row", () => {
    expect(validateStep("plans", rows())).toMatch(/at least one/);
    expect(validateStep("plans", rows({}, { name: "Monthly", price: "1500" }))).toBeNull();
    expect(planRows(rows({}, { name: "Monthly", price: "1500" }))).toHaveLength(1);
  });
  it("names the plan that is wrong", () => {
    expect(validateStep("plans", rows({ price: "1500" }))).toBe("Every plan needs a name.");
    expect(validateStep("plans", rows({ name: "Gold", price: "" , months: "3" }))).toBe("Gold: enter a price.");
    expect(validateStep("plans", rows({ name: "Gold", price: "0" }))).toBe("Gold: enter a price.");
    expect(validateStep("plans", rows({ name: "Gold", price: "1,500", months: "0" }))).toMatch(/Gold: duration/);
    expect(validateStep("plans", rows({ name: "Gold", price: "1500", months: "61" }))).toMatch(/Gold: duration/);
    expect(validateStep("plans", rows({ name: "Gold", price: "1500", regFee: "abc" }))).toMatch(/registration fee/);
    expect(validateStep("plans", rows({ name: "Gold", price: "₹1,499.50", regFee: "500" }))).toBeNull();
  });
  it("refuses two plans with the same name, however it is typed", () => {
    expect(validateStep("plans", rows({ name: "Monthly", price: "1" }, { name: " monthly ", price: "2" }))).toBe("Two plans have the same name.");
  });
  it("guesses personal training from the name", () => {
    expect(planKind("Personal Training 12 sessions")).toBe("Personal Training");
    expect(planKind("PT Monthly")).toBe("Personal Training");
    expect(planKind("Monthly")).toBe("Membership");
    expect(planKind("Optimum")).toBe("Membership");
  });
});

describe("Team", () => {
  const person = (over = {}) => ({ ...emptyStaff(), name: "Asha Rao", phone: "9876543210", email: "asha@gym.test", password: "first-pass-1", ...over });
  const team = (...s: ReturnType<typeof person>[]) => form({ staff: s });
  it("is optional: an untouched row is no one", () => {
    expect(validateStep("staff", team(emptyStaff()))).toBeNull();
    expect(staffRows(team(emptyStaff()))).toHaveLength(0);
  });
  it("checks each person it is given", () => {
    expect(validateStep("staff", team(person()))).toBeNull();
    expect(validateStep("staff", team(person({ name: "" })))).toBe("Each team member needs a name.");
    expect(validateStep("staff", team(person({ phone: "12345" })))).toBe("Asha Rao: enter a 10-digit mobile number.");
    expect(validateStep("staff", team(person({ email: "nope" })))).toBe("Asha Rao: enter a valid email to sign in with.");
    expect(validateStep("staff", team(person({ password: "short" })))).toBe("Asha Rao: set a first password of at least 8 characters.");
  });
  it("reads a phone with +91 or spaces the way the rest of the app does", () => {
    expect(validateStep("staff", team(person({ phone: "+91 98765-43210" })))).toBeNull();
  });
  it("a row with only a password still counts, so a half-filled person isn't silently dropped", () => {
    expect(validateStep("staff", team({ ...emptyStaff(), password: "something" }))).toBe("Each team member needs a name.");
  });
  it("refuses the same email twice", () => {
    expect(validateStep("staff", team(person(), person({ name: "Ravi Kumar", email: "ASHA@gym.test" })))).toBe("Two team members have the same email.");
  });
});

describe("Opening balances and the start", () => {
  it("accepts blank or an amount", () => {
    expect(validateStep("opening", form({ opening: { cash: "", bank: "" } }))).toBeNull();
    expect(validateStep("opening", form({ opening: { cash: "₹12,500", bank: "40000.50" } }))).toBeNull();
    expect(validateStep("opening", form({ opening: { cash: "lots", bank: "" } }))).toMatch(/cash balance/);
    expect(validateStep("opening", form({ opening: { cash: "", bank: "-5" } }))).toMatch(/bank balance/);
  });
  it("only knows two ways to start", () => {
    expect(validateStep("start", form({ mode: "import" }))).toBeNull();
    expect(validateStep("start", form({ mode: "demo" as never }))).toMatch(/how you want to start/);
  });
});

describe("firstInvalid", () => {
  it("finds the first step that is wrong, in the order the owner sees them", () => {
    const f = form({ branch: { short: "", hours: "", manager: "" }, rows: [] });
    const steps: StepKey[] = ["tax", "branch", "plans", "start", "review"];
    expect(firstInvalid(steps, f)).toMatchObject({ step: "branch" });
    expect(firstInvalid(["plans"], f)).toMatchObject({ step: "plans", message: "Add at least one membership plan." });
    expect(firstInvalid(steps, defaultForm())).toBeNull();
  });
  it("ignores steps the gym doesn't see", () => {
    const f = form({ staff: [{ ...emptyStaff(), name: "x" }] });
    expect(firstInvalid(stepsFor(has("starter")), f)).toBeNull();
    expect(firstInvalid(stepsFor(has("professional")), f)).toMatchObject({ step: "staff" });
  });
});

describe("the review", () => {
  it("lists only the steps this gym has", () => {
    const f = form({ tax: { ...defaultForm().tax, gst: true, gstin: GSTIN_OK.toLowerCase(), rate: "12", type: "IGST", prefix: "fit-", start: "250" }, mode: "import" });
    const all = Object.fromEntries(reviewRows(f, stepsFor(has("professional"))).map((r) => [r.k, r.v]));
    expect(all.GST).toBe("20ABCDE1234F1Z5 · 12% IGST");
    expect(all.Invoices).toBe("FIT-250 onwards");
    expect(all.Plans).toBe("Monthly ₹1,500, Quarterly ₹4,000, Half-Yearly ₹7,500, Annual ₹13,000");
    expect(all.Team).toBe("Only you for now");
    expect(all.WhatsApp).toContain("welcome message");
    expect(all["Opening balances"]).toBe("Not set");
    expect(all.Start).toBe("Import members next");
    expect(reviewRows(f, stepsFor(has("starter"))).map((r) => r.k)).toEqual(["GST", "Invoices", "Branch", "Plans", "Start"]);
  });
  it("says what the team and balances are once they are filled in", () => {
    const f = form({ staff: [{ ...emptyStaff(), name: "Asha Rao", role: "Trainer" }], opening: { cash: "1000", bank: "2,50,000" } });
    const all = Object.fromEntries(reviewRows(f, stepsFor(has("professional"))).map((r) => [r.k, r.v]));
    expect(all.Team).toBe("Asha Rao (Trainer)");
    expect(all["Opening balances"]).toBe("Cash ₹1,000 · Bank ₹2,50,000");
  });
  it("shows paise only when there are some", () => {
    const f = form({ opening: { cash: "₹12,500", bank: "2,40,000.5" } });
    const all = Object.fromEntries(reviewRows(f, stepsFor(has("professional"))).map((r) => [r.k, r.v]));
    expect(all["Opening balances"]).toBe("Cash ₹12,500 · Bank ₹2,40,000.50");
  });
});
