import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** Phrases the prototype does not use. Later steps may extend this list. */
export const RETIRED = [
  "Edit & role", "Search actions, IDs, records", "Refused today", "Sent · 30 days", "Message history", "Depreciation FY",
  "fingerprint and card entry", "Log in", "Logging in", "Forgot your password", "the daily job sends these each morning",
  "sent by hand", "Message a group", "Gym name (shown on invoices)", "How messages are sent", "Last sign-in", "Never signed in",
  "Add measurement", "Body fat %",
];
/** "Partly paid" is retired everywhere (purchases use "Part paid"). */
const RETIRED_EVERYWHERE = ["Partly paid"];
const REQUIRED = ["Change role", "Search actions, IDs, users", "Denied today", "Live access log", "Depreciation this FY", "Sign in to Fitron", "Sent this month", "Message log", "Consolidated view · click a branch to open it"];

const ROOT = join(__dirname, "../..");
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n) ? [p] : [];
  });
}
const files = ["app/(app)", "app/login", "app/(site)", "components"].flatMap((d) => walk(join(ROOT, d)));
// Compared with "/" so the exemptions below match on Windows too, where join() gives "\".
const text = files.map((f) => ({ f, s: readFileSync(f, "utf8"), p: f.replaceAll("\\", "/") }));

describe("wording", () => {
  it.each([...RETIRED, ...RETIRED_EVERYWHERE])("never uses %s", (phrase) => {
    // Profile's own "Last sign-in" fact is the person's own account page, not the staff card.
    const hits = text.filter(({ p, s }) => s.includes(phrase) && !(phrase === "Last sign-in" && p.endsWith("profile/page.tsx"))).map((x) => x.f);
    expect(hits).toEqual([]);
  });
  it.each(REQUIRED)("uses %s", (phrase) => {
    expect(text.some(({ s }) => s.includes(phrase))).toBe(true);
  });
});
