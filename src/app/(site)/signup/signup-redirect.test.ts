import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { PLANS, findPlan } from "@/lib/domain/pricing";

// The form needs the database layer; the redirect decision doesn't.
vi.mock("./trial-form", () => ({ TrialForm: () => null }));

import SignupPage from "./page";

/** Renders /signup for a query. Returns where it redirects to, or null when it shows the page. */
async function visit(q: Record<string, string>): Promise<string | null> {
  try {
    await SignupPage({ searchParams: Promise.resolve(q) } as never);
    return null;
  } catch (e) {
    const digest = String((e as { digest?: unknown }).digest ?? "");
    if (!digest.startsWith("NEXT_REDIRECT")) throw e;
    return digest.split(";")[2]!;
  }
}

describe("/signup", () => {
  it("opens the Gym Accounting sign-in on its Create account tab, with the plan and billing picked", async () => {
    expect(await visit({ plan: "professional" })).toBe("/login?tab=up&plan=professional&cycle=MONTHLY");
    expect(await visit({ plan: "starter", cycle: "year" })).toBe("/login?tab=up&plan=starter&cycle=YEARLY");
    expect(await visit({ plan: "enterprise", cycle: "YEARLY" })).toBe("/login?tab=up&plan=enterprise&cycle=YEARLY");
  });

  it("opens the AI Trainer for an AI Trainer plan", async () => {
    expect(await visit({ plan: "ai-pro" })).toBe("/trainer?plan=ai-pro");
    expect(await visit({ plan: "ai-premium" })).toBe("/trainer?plan=ai-premium");
  });

  it("starts on the default gym plan when none is given", async () => {
    expect(await visit({})).toBe("/login?tab=up&plan=professional&cycle=MONTHLY");
    expect(await visit({ plan: "nonsense" })).toBe("/login?tab=up&plan=professional&cycle=MONTHLY");
  });

  it("keeps a Google message for someone sent back here by an older link", async () => {
    expect(await visit({ plan: "starter", google: "cancelled" })).toBe("/login?tab=up&plan=starter&cycle=MONTHLY&google=cancelled");
  });

  it("still shows its own page for the partner plans", async () => {
    expect(await visit({ plan: "partner-referral" })).toBeNull();
    expect(await visit({ plan: "partner-software" })).toBeNull();
  });

  it("sends every trial button on fitron.in to its own product's sign-in", async () => {
    const html = readFileSync(new URL("../../../../public/site/index.html", import.meta.url), "utf8");
    const keys = [...new Set([...html.matchAll(/href="\/signup\?plan=([a-z-]+)"/g)].map((m) => m[1]!))];
    expect(keys.length).toBeGreaterThan(5);
    for (const key of keys) {
      const product = findPlan(key)!.product;
      const to = await visit({ plan: key });
      if (product === "GYM_ACCOUNTING") expect(to, key).toMatch(new RegExp(`^/login\\?tab=up&plan=${key}&`));
      else if (product === "AI_TRAINER") expect(to, key).toBe(`/trainer?plan=${key}`);
      else expect(to, key).toBeNull();
    }
    // Every gym and AI Trainer plan has a button.
    for (const p of PLANS.filter((x) => x.product !== "PARTNER")) expect(keys, p.key).toContain(p.key);
  });
});
