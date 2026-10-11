import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installation } from "./store";

// The trial counts Indian calendar days, from the day FITRON was set up in India's calendar.

let root: string;
beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "fitron-licence-"));
  vi.stubEnv("FITRON_SECRETS", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

const installedAt = (iso: string) => writeFileSync(path.join(root, "secrets.json"), JSON.stringify({ installationId: "inst-1", createdAt: iso }));

describe("the installation day", () => {
  it("is India's calendar day of the installation, so a set-up after midnight in India starts the trial that day", () => {
    // 01:00 on 12 October in India is still 11 October in UTC.
    installedAt("2026-10-11T19:30:00.000Z");
    expect(installation(root, "2026-10-12")).toEqual({ installationId: "inst-1", installedOn: "2026-10-12" });
    installedAt("2026-10-11T18:29:59.000Z");
    expect(installation(root, "2026-10-12").installedOn).toBe("2026-10-11");
  });

  it("is today before the installation's secrets exist, or when the date in them is unreadable", () => {
    expect(installation(root, "2026-10-12")).toEqual({ installationId: "", installedOn: "2026-10-12" });
    installedAt("not a date");
    expect(installation(root, "2026-10-12").installedOn).toBe("2026-10-12");
  });
});
