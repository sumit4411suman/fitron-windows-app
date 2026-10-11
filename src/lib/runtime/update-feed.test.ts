import { describe, expect, it } from "vitest";
import { installerName, updateFeed } from "../../../scripts/desktop/update-feed";

// Phase 18: the feed a release publishes, which FITRON for Windows reads to find an update.

describe("the update feed", () => {
  it("names the release, the installer beside the feed, and FITRON's signature over it", () => {
    const f = updateFeed({ version: "1.1.0", notes: "Receipts on thermal printers.\n", feedUrl: "https://downloads.fitron.in/windows/latest.json", signature: "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkK...\n", date: new Date("2026-10-11T16:00:00.123Z") });
    expect(f).toEqual({
      version: "1.1.0",
      notes: "Receipts on thermal printers.",
      pub_date: "2026-10-11T16:00:00Z",
      platforms: { "windows-x86_64": { url: "https://downloads.fitron.in/windows/FITRON-Gym-Accounting-Setup-1.1.0.exe", signature: "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkK..." } },
    });
    expect(installerName("1.2.0")).toBe("FITRON-Gym-Accounting-Setup-1.2.0.exe");
  });

  it("refuses a feed that could not be trusted or found", () => {
    const ok = { version: "1.1.0", notes: "", feedUrl: "https://downloads.fitron.in/windows/latest.json", signature: "sig", date: new Date() };
    expect(() => updateFeed({ ...ok, feedUrl: "http://downloads.fitron.in/windows/latest.json" })).toThrow(/https/);
    expect(() => updateFeed({ ...ok, feedUrl: "https://downloads.fitron.in/windows/" })).toThrow(/latest\.json/);
    expect(() => updateFeed({ ...ok, signature: "  " })).toThrow(/signing key/);
    expect(() => updateFeed({ ...ok, version: "1.1" })).toThrow(/release version/);
  });
});
