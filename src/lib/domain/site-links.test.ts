import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { googleBackUrl } from "@/lib/integrations/google";
import { GYM_SIGNIN_HREF, TRAINER_HREF, gymSignupHref, trainerHref } from "./site-links";

const page = (p: string) => readFileSync(new URL(`../../../public/${p}`, import.meta.url), "utf8");

describe("gymSignupHref", () => {
  it("opens the Create account tab of the console's sign-in", () => {
    expect(gymSignupHref()).toBe("/login?tab=up");
  });
  it("carries the plan, the billing cycle and a Google code", () => {
    expect(gymSignupHref({ plan: "starter", cycle: "YEARLY" })).toBe("/login?tab=up&plan=starter&cycle=YEARLY");
    expect(gymSignupHref({ plan: "professional", google: "1" })).toBe("/login?tab=up&plan=professional&google=1");
  });
  it("leaves out what is empty", () => {
    expect(gymSignupHref({ plan: "", cycle: null, google: undefined })).toBe("/login?tab=up");
  });
});

describe("trainerHref", () => {
  it("opens the member app, remembering the tier picked", () => {
    expect(trainerHref()).toBe("/trainer");
    expect(trainerHref("ai-premium")).toBe("/trainer?plan=ai-premium");
  });
});

describe("googleBackUrl", () => {
  it("sends a gym sign-up back to the Create account tab with its plan, in one query string", () => {
    expect(googleBackUrl("signup", "cancelled", { plan: "starter", cycle: "YEARLY" })).toBe("/login?tab=up&plan=starter&cycle=YEARLY&google=cancelled");
    expect(googleBackUrl("signup", "off")).toBe("/login?tab=up&google=off");
  });
  it("sends the console login and the AI Trainer back to their own page", () => {
    expect(googleBackUrl("staff", "expired")).toBe("/login?google=expired");
    expect(googleBackUrl("trainer", "failed")).toBe("/trainer?google=failed");
  });
});

describe("fitron.in's Log in", () => {
  const html = page("site/index.html");
  it("opens the sign-in chooser, and only Open Gym Accounting goes straight to the console", () => {
    // Header and phone menu: "Sign In" opens the chooser, never a product's own sign-in.
    expect([...html.matchAll(/href="\/signin"[^>]*>Sign In</g)]).toHaveLength(2);
    expect(html).not.toMatch(/href="\/login"[^>]*>(Log in|Sign In)/);
    expect(html).toMatch(/href="\/login">Open Gym Accounting/);
  });
  it("is what scripts/import-site.py produces", () => {
    const script = readFileSync(new URL("../../../scripts/import-site.py", import.meta.url), "utf8");
    expect(script).toContain('<a href="/signin">Log in</a>');
    expect(script).not.toContain('<a href="/login">Log in</a>');
  });
});

describe("the AI Trainer's sign-in", () => {
  const html = page("trainer/index.html");
  it("links gym owners and staff to the Gym Accounting sign-in, and back to fitron.in", () => {
    expect(html).toContain(`Gym owner or staff? <a href="${GYM_SIGNIN_HREF}"`);
    expect(html).toContain('<a href="/" aria-label="FITRON home"');
  });
  it("is served where the other pages link to it", () => {
    expect(TRAINER_HREF).toBe("/trainer");
  });
});
