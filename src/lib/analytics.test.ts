import { describe, expect, it } from "vitest";
import { analyticsId } from "./analytics";

describe("analyticsId", () => {
  it("is null when no ID is set, so no analytics is loaded", () => {
    expect(analyticsId({})).toBeNull();
    expect(analyticsId({ GA_MEASUREMENT_ID: "  " })).toBeNull();
  });
  it("accepts a GA4 measurement ID and nothing that could break out of a script address", () => {
    expect(analyticsId({ GA_MEASUREMENT_ID: " G-ABC123XYZ9 " })).toBe("G-ABC123XYZ9");
    for (const bad of ["UA-12345-1", "G-", "G-abc123", "G-ABC123&x=1", "https://evil.example/x.js"]) expect(analyticsId({ GA_MEASUREMENT_ID: bad }), bad).toBeNull();
  });
});
