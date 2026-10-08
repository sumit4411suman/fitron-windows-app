import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";

const root = path.join(__dirname, "..");
const all = async () => {
  const rules = await nextConfig.headers!();
  return Object.fromEntries(rules.find((r) => r.source === "/:path*")!.headers.map((h) => [h.key, h.value]));
};

describe("headers sent with every page", () => {
  it("keeps the device camera available to our own pages: the attendance QR scanner needs it", async () => {
    const policy = (await all())["Permissions-Policy"]!;
    expect(policy.split(",").map((s) => s.trim())).toContain("camera=(self)");
    // The scanner really does ask for the camera; if it stops, this reminder can go.
    expect(readFileSync(path.join(root, "src/app/(app)/attendance/attendance-forms.tsx"), "utf8").includes("getUserMedia")).toBe(true);
  });

  it("still denies the microphone and location to every page, and framing by other sites", async () => {
    const h = await all();
    const policy = h["Permissions-Policy"]!;
    for (const p of ["microphone=()", "geolocation=()"]) expect(policy.includes(p), p).toBe(true);
    expect(h["X-Frame-Options"]).toBe("DENY");
  });

  it("lets only our own pages frame the Gym Accounting, AI Coach and Partner Console live demos, and only those files", async () => {
    const rules = await nextConfig.headers!();
    const framed = rules.filter((r) => r.headers.some((h) => h.key === "X-Frame-Options" && h.value !== "DENY"));
    expect(framed.map((r) => r.source)).toEqual(["/site/gym-demo.html", "/site/coach-demo.html", "/site/partner-demo.html"]);
    for (const rule of framed) {
      expect(rule.headers.find((h) => h.key === "X-Frame-Options")!.value).toBe("SAMEORIGIN");
      // It must come after the rule for every page, so that its value is the one sent.
      expect(rules.indexOf(rule)).toBeGreaterThan(rules.findIndex((r) => r.source === "/:path*"));
    }
  });
});
