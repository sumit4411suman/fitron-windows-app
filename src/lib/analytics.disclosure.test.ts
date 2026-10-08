import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// What the tracker really does and what the Privacy Policy and the cookie banners say it does must stay the same.

const root = path.join(__dirname, "../..");
const read = (f: string) => readFileSync(path.join(root, f), "utf8");
const tracker = read("public/site/analytics.js");
const privacy = read("src/app/(site)/privacy/page.tsx");
const banners = [read("src/app/(site)/site-consent.tsx"), read("scripts/site/consent.html")];

describe("the Privacy Policy and the analytics tracker", () => {
  it("name the provider the tracker loads, and the cookies it sets", () => {
    expect(tracker).toContain("https://www.googletagmanager.com/gtag/js");
    expect(privacy).toContain("Google Analytics");
    expect(privacy).toContain("_ga");
  });

  it("say what the tracker does not do: no advertising features, nothing before consent", () => {
    expect(tracker).toContain("allow_google_signals: false");
    expect(tracker).toContain("allow_ad_personalization_signals: false");
    expect(privacy).toContain("switch off Google&apos;s advertising features and Google signals");
    expect(privacy).toContain("If you do not agree, no Google script is loaded");
    expect(tracker).toContain("if (!allowed()) return;");
  });

  it("say that Google may process the data outside India", () => {
    expect(privacy).toMatch(/Google processes this on its own servers, which may be outside India/);
  });

  it("do not call the analytics anonymous: Google Analytics uses a cookie identifier", () => {
    for (const text of [privacy, ...banners]) expect(text).not.toMatch(/nonymi[sz]ed analytics|Anonymised counts/);
  });

  it("send no name, email or phone number", () => {
    // Event names such as email_click are fine; a parameter carrying a person's details is not.
    expect(tracker).not.toMatch(/\b(e-?mail|phone|mobile|name|password|otp)\s*:/i);
  });
});
