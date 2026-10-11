import { describe, expect, it } from "vitest";
import type { PrismaClient } from "../../src/generated/prisma/index.js";
import { DEFAULT_TEMPLATES, placeholdersIn, renderTemplate, TemplateService, validateTemplateBody } from "../../src/services/TemplateService.js";
import { FakeDb } from "../helpers/fakeDb.js";

describe("template engine", () => {
  it("fills known variables and blanks missing ones", () => {
    expect(renderTemplate("Hi {{name}}, {{membershipPlan}} at {{ gymName }} expires {{expiryDate}}.", { name: "Rahul", gymName: "Iron", expiryDate: "15 Oct 2026" })).toBe("Hi Rahul,  at Iron expires 15 Oct 2026.");
    expect(placeholdersIn("{{name}} {{name}} {{amount}}")).toEqual(["name", "amount"]);
  });
  it.each(["Hello {{ unknownVar }}", "{{name.toUpperCase()}}", "${process.env.X}", "<script>alert(1)</script>", "{{name}}{{constructor}}", ""])("rejects %s", (body) => {
    expect(() => validateTemplateBody(body)).toThrow();
  });
  it("ships defaults for every Fitron event", () => {
    for (const name of ["welcome", "membership-expiry", "payment-reminder", "birthday", "renewal-reminder", "payment-receipt", "attendance"]) expect(DEFAULT_TEMPLATES.some((t) => t.name === name)).toBe(true);
    for (const t of DEFAULT_TEMPLATES) expect(() => validateTemplateBody(t.body)).not.toThrow();
    expect(DEFAULT_TEMPLATES.find((t) => t.name === "birthday")?.category).toBe("MARKETING");
  });
});

describe("TemplateService", () => {
  const svc = () => new TemplateService(new FakeDb() as unknown as PrismaClient);
  it("falls back to defaults, allows customising and resetting per gym", async () => {
    const s = svc();
    const def = await s.get("g1", "welcome");
    expect(def.isDefault).toBe(true);
    await s.upsert("g1", "welcome", { body: "Yo {{name}}" });
    expect((await s.get("g1", "welcome")).body).toBe("Yo {{name}}");
    expect((await s.get("g2", "welcome")).body).toBe(def.body); // another gym is untouched
    expect((await s.render("g1", "welcome", { name: "A" })).text).toBe("Yo A");
    await s.upsert("g1", "welcome", { body: "Yo {{name}}", active: false });
    await expect(s.render("g1", "welcome", {})).rejects.toThrow(/switched off/);
    await s.reset("g1", "welcome");
    expect((await s.get("g1", "welcome")).isDefault).toBe(true);
    await expect(s.upsert("g1", "welcome", { body: "{{nope}}" })).rejects.toThrow(/Unknown template variable/);
    await expect(s.get("g1", "nothing")).rejects.toMatchObject({ code: "TEMPLATE_NOT_FOUND" });
  });
});
