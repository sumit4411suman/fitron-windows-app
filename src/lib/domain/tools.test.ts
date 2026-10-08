import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { isPublicPath } from "@/lib/public-paths";
import { TOOLS, TOOLS_PATH, toolPath } from "./tools";

const root = path.join(__dirname, "../../..");
const ui = readFileSync(path.join(root, "src/app/(site)/tools/calculators.tsx"), "utf8");
const home = readFileSync(path.join(root, "public/site/index.html"), "utf8");

describe("the free calculators", () => {
  it("has at least the eight calculators of the plan, each with its own address, title and description", () => {
    expect(TOOLS.length).toBeGreaterThanOrEqual(8);
    expect(new Set(TOOLS.map((t) => t.slug)).size).toBe(TOOLS.length);
    expect(new Set(TOOLS.map((t) => t.title)).size).toBe(TOOLS.length);
    for (const t of TOOLS) {
      expect(t.title.length, t.slug).toBeLessThanOrEqual(65);
      expect(t.title.endsWith("| FITRON"), t.slug).toBe(true);
      expect(t.description.length, t.slug).toBeGreaterThanOrEqual(70);
      expect(t.description.length, t.slug).toBeLessThanOrEqual(160);
      expect(t.method.length, `${t.slug} says how it works`).toBeGreaterThanOrEqual(3);
      expect(t.faq.length, t.slug).toBeGreaterThanOrEqual(2);
      expect(t.note.length, `${t.slug} carries its caution`).toBeGreaterThan(40);
    }
  });

  it("has a screen for each one", () => {
    for (const t of TOOLS) expect(ui.includes(`"${t.slug}":`), t.slug).toBe(true);
  });

  it("says its result is not tax or medical advice, as the kind of tool requires", () => {
    for (const t of TOOLS.filter((x) => x.audience === "fitness")) expect(t.note, t.slug).toContain("not medical advice");
    for (const t of TOOLS.filter((x) => x.audience === "gym")) expect(t.note, t.slug).toMatch(/not (accounting or )?tax advice/);
  });

  it("makes no claim of results, ratings or guarantees", () => {
    for (const t of TOOLS) expect(JSON.stringify(t), t.slug).not.toMatch(/\bguarantee|\brated\b|\breviews?\b|\bbest in\b|#1|lose \d+ ?kg/i);
  });

  it("is open to visitors, in the sitemap, in robots.txt and linked from the home page footer", () => {
    expect(isPublicPath(TOOLS_PATH)).toBe(true);
    const urls = sitemap().map((s) => s.url);
    const rule = robots().rules as { allow: string[] };
    for (const p of [TOOLS_PATH, ...TOOLS.map(toolPath)]) {
      expect(isPublicPath(p), p).toBe(true);
      expect(urls, p).toContain(`https://fitron.in${p}`);
    }
    expect(rule.allow).toContain(TOOLS_PATH);
    expect(home.includes('href="/tools"')).toBe(true);
  });

  it("leads each one to the product page it belongs to", () => {
    for (const t of TOOLS) expect(["/gym-accounting", "/gym-gst-billing", "/gym-management-software", "/ai-personal-trainer"], t.slug).toContain(t.product[1]);
  });
});
