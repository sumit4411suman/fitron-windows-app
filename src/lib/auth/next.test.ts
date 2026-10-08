import { describe, expect, it } from "vitest";
import { safeNext } from "./next";

describe("safeNext", () => {
  it("keeps paths on this site", () => {
    expect(safeNext("/invoices/abc?x=1")).toBe("/invoices/abc?x=1");
  });
  it("refuses other hosts and odd values", () => {
    for (const bad of ["https://evil.com", "//evil.com", "/\\evil.com", "", null, "dashboard", "/login?next=/x", "/"]) expect(safeNext(bad)).toBe("/dashboard");
  });
  it("refuses paths that a browser would turn into another host", () => {
    for (const bad of ["/\t/evil.com", "/\n/evil.com", "/\r/evil.com", "/ /evil.com", "/x\\..\\evil.com", "/\u0000/evil.com"]) {
      expect(safeNext(bad)).toBe("/dashboard");
      expect(new URL(safeNext(bad), "https://fitron.in").host).toBe("fitron.in");
    }
  });
});
