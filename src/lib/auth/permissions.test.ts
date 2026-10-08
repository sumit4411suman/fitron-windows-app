import { describe, expect, it } from "vitest";
import { DEFAULT_ROLES, PERMISSIONS } from "./permissions";

describe("default roles", () => {
  it("only grant known permissions", () => {
    for (const perms of Object.values(DEFAULT_ROLES)) for (const p of perms) expect(PERMISSIONS).toHaveProperty(p);
  });

  it("keep month unlock and staff management with the Super Admin", () => {
    for (const [role, perms] of Object.entries(DEFAULT_ROLES)) {
      const has = (p: string) => (perms as string[]).includes(p);
      expect(has("months.unlock")).toBe(role === "Super Admin");
      expect(has("staff.manage")).toBe(role === "Super Admin");
    }
  });

  it("give payroll to Super Admin, Admin and Accountant only", () => {
    for (const [role, perms] of Object.entries(DEFAULT_ROLES)) expect((perms as string[]).includes("payroll.manage")).toBe(["Super Admin", "Admin", "Accountant"].includes(role));
  });

  it("keep receptionists and trainers out of accounting", () => {
    expect(DEFAULT_ROLES.Receptionist).not.toContain("accounting.view");
    expect(DEFAULT_ROLES.Trainer).not.toContain("accounting.view");
    expect(DEFAULT_ROLES.Trainer).not.toContain("members.all");
  });
});
