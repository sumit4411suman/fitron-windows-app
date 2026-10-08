import { describe, expect, it } from "vitest";
import { gymSignupSchema, signupStep1Schema } from "./site";

const base = { plan: "professional", cycle: "MONTHLY", name: "Owner One", email: "o@gym.test", phone: "9876543210", business: "Iron Den", password: "a-long-password", terms: "on" };
const msgs = (r: { success: boolean; error?: { issues: { message: string }[] } }) => r.error?.issues.map((i) => i.message) ?? [];

describe("signupStep1Schema", () => {
  const ok = { name: "Owner", email: "o@gym.test", password: "a-long-password", terms: "on" };
  it("accepts good input", () => expect(signupStep1Schema.safeParse(ok).success).toBe(true));
  it("rejects each bad field with its message", () => {
    expect(msgs(signupStep1Schema.safeParse({ ...ok, name: "O" }))).toContain("Enter your name.");
    expect(msgs(signupStep1Schema.safeParse({ ...ok, email: "nope" }))).toContain("Enter a valid email address.");
    expect(msgs(signupStep1Schema.safeParse({ ...ok, password: "123456789" }))).toContain("Use at least 10 characters.");
    expect(msgs(signupStep1Schema.safeParse({ ...ok, terms: "" }))).toContain("Please tick “I agree to Fitron’s Terms…” to continue.");
  });
});

describe("gymSignupSchema", () => {
  it("still accepts the /signup payload with no profile fields", () => {
    expect(gymSignupSchema.safeParse(base).success).toBe(true);
  });
  it("requires the profile when it comes from the login card", () => {
    const m = msgs(gymSignupSchema.safeParse({ ...base, source: "login" }));
    expect(m).toContain("Enter a valid gym email.");
    expect(m).toContain("Enter the address and city.");
    expect(m).toContain("PIN code must be 6 digits.");
    expect(msgs(gymSignupSchema.safeParse({ ...base, source: "login", gymEmail: "g@gym.test", address: "Shop 4", city: "Bokaro", pin: "12" }))).toEqual(["PIN code must be 6 digits."]);
    expect(gymSignupSchema.safeParse({ ...base, source: "login", gymEmail: "g@gym.test", address: "Shop 4", city: "Bokaro", pin: "827004" }).success).toBe(true);
  });
  it("normalises the phone and blanks optional text", () => {
    const r = gymSignupSchema.safeParse({ ...base, phone: "+91 98765-43210", tagline: " ", website: "", instagram: "" });
    expect(r.success && r.data.phone).toBe("9876543210");
    expect(r.success && [r.data.tagline, r.data.website, r.data.instagram]).toEqual([undefined, undefined, undefined]);
  });
});
