import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PARTNER_SHARE, PLANS, findPlan, lowestGymPrice, rupeesLabel, type PlanDef } from "./pricing";
import { trainerPrice } from "./trainer";
import { formatInr } from "./billing";

describe("pricing", () => {
  it("formats rupees the Indian way", () => {
    expect(rupeesLabel(19_99_000)).toBe("₹19,990");
    expect(rupeesLabel(39_99_000)).toBe("₹39,990");
    expect(rupeesLabel(29_950)).toBe("₹299.5");
  });

  it("finds the lowest gym price for the login page", () => {
    const yearly = Math.min(...PLANS.filter((p) => p.product === "GYM_ACCOUNTING").map((p) => p.price.YEARLY));
    expect(lowestGymPrice("YEARLY")).toBe(yearly);
    expect(formatInr(lowestGymPrice("YEARLY")).replace(/\.00$/, "")).toBe("₹9,990");
  });

  it("finds plans by key", () => {
    expect(findPlan("starter")?.memberLimit).toBe(100);
    expect(findPlan("nope")).toBeUndefined();
  });

  it("matches every price shown on the pricing page", () => {
    const page = readFileSync(new URL("../../../public/site/index.html", import.meta.url), "utf8");
    for (const p of PLANS) {
      for (const paise of Object.values(p.price)) expect(page, `${p.name} ${paise}`).toContain(rupeesLabel(paise).slice(1));
    }
  });

  it("shows partners what the console pays them: 70% of the price before GST, for every AI Trainer price", () => {
    const page = readFileSync(new URL("../../../public/site/index.html", import.meta.url), "utf8");
    const rupees = (paise: number) => "₹" + (paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const rows = [...page.matchAll(/<tr><td>(₹[\d,]+) \/ (month|year)<\/td><td class="num g">([^<]+)<\/td><td class="num">([^<]+)<\/td><\/tr>/g)].map((m) => ({ price: m[1], per: m[2], gym: m[3], fitron: m[4] }));
    expect(rows).toHaveLength(4);
    for (const plan of ["ai-pro", "ai-premium"] as const) {
      for (const [cycle, per] of [["MONTHLY", "month"], ["YEARLY", "year"]] as const) {
        const { base, total } = trainerPrice(plan, cycle);
        const share = Math.round(base * PARTNER_SHARE);
        const row = rows.find((r) => r.price === rupeesLabel(total) && r.per === per);
        expect(row, `${plan} ${cycle} is in the table`).toBeDefined();
        expect(row, `${plan} ${cycle}`).toMatchObject({ gym: rupees(share), fitron: rupees(base - share) });
      }
    }
  });

  it("shows the same plan cards as the pricing page", () => {
    // The page's HTML may escape characters or wrap text across lines; compare its visible text.
    const page = readFileSync(new URL("../../../public/site/index.html", import.meta.url), "utf8")
      .replace(/<[^>]+>/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&middot;|&#183;/g, "·")
      .replace(/\s+/g, " ");
    const gym: readonly PlanDef[] = PLANS.filter((p) => p.product === "GYM_ACCOUNTING");
    expect(gym.every((p) => p.card)).toBe(true);
    for (const p of gym) for (const line of [p.card!.audience, p.card!.limit, ...(p.card!.includes ? [p.card!.includes] : []), ...p.card!.features]) expect(page, `${p.name}: ${line}`).toContain(line);
  });

  it("links every trial button on the pricing page to a real plan", () => {
    const page = readFileSync(new URL("../../../public/site/index.html", import.meta.url), "utf8");
    const keys = [...page.matchAll(/href="\/signup\?plan=([a-z-]+)"/g)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThan(5);
    for (const k of keys) expect(findPlan(k), k).toBeDefined();
  });
});
