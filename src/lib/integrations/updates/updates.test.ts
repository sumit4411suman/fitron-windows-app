import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const net = vi.hoisted(() => ({ up: true }));
vi.mock("../online", async (importOriginal) => ({ ...(await importOriginal<typeof import("../online")>()), probablyOnline: vi.fn(async () => net.up) }));
const urls: string[] = [];
let answer: { status: number; json: unknown } = { status: 200, json: { version: "1.1.0", notes: "Faster reports.", pub_date: "2026-11-01T00:00:00Z" } };
vi.stubGlobal(
  "fetch",
  vi.fn(async (url: string) => {
    urls.push(url);
    return new Response(JSON.stringify(answer.json), { status: answer.status });
  }),
);

import { latestRelease, latestWindowsInstaller, updateQueryString, WINDOWS_FEED, WINDOWS_RELEASES } from ".";
import { GET as download } from "@/app/download/windows/route";

const q = { edition: "local", version: "1.0.0", channel: "stable", platform: "windows-x86_64" };

afterEach(() => {
  vi.unstubAllEnvs();
  urls.length = 0;
  net.up = true;
  answer = { status: 200, json: { version: "1.1.0", notes: "Faster reports.", pub_date: "2026-11-01T00:00:00Z" } };
});

describe("the update feed hears the version, never the gym", () => {
  it("asks with the edition, version, channel and platform only", async () => {
    expect(updateQueryString(q)).toBe("edition=local&version=1.0.0&channel=stable&platform=windows-x86_64");
    expect(() => updateQueryString({ ...q, gym: "Iron Gym" })).toThrow(/^Not sent to the update feed: gym/);
    expect(() => updateQueryString({ ...q, version: "1.0.0 members=5000" })).toThrow("version as a short code");
    vi.stubEnv("FITRON_UPDATE_URL", "https://updates.example.com/fitron/latest.json");
    expect(await latestRelease(q)).toEqual({ ok: true, data: { version: "1.1.0", notes: "Faster reports.", publishedAt: "2026-11-01T00:00:00Z" } });
    expect(urls).toEqual(["https://updates.example.com/fitron/latest.json?edition=local&version=1.0.0&channel=stable&platform=windows-x86_64"]);
  });

  it("not set up, offline or a broken feed: an answer for the screen, never an error page", async () => {
    expect(await latestRelease(q)).toMatchObject({ ok: false, reason: "not-configured" });
    vi.stubEnv("FITRON_UPDATE_URL", "https://updates.example.com/latest.json");
    net.up = false;
    expect(await latestRelease(q)).toMatchObject({ ok: false, reason: "offline", message: expect.stringMatching(/^Checking for FITRON updates requires an internet connection\./) });
    expect(urls).toEqual([]);
    net.up = true;
    answer = { status: 200, json: { notes: "no version" } };
    expect(await latestRelease(q)).toEqual({ ok: false, reason: "refused", message: "The update feed did not name a version." });
    answer = { status: 500, json: {} };
    expect(await latestRelease(q)).toMatchObject({ ok: false, reason: "refused" });
  });
});

describe("the website's download link (fitron.in/download/windows)", () => {
  const feed = (url: unknown, version: unknown = "0.1.2") => ({ status: 200, json: { version, notes: "Doors.", platforms: { "windows-x86_64": { url, signature: "x" } } } });
  const exe = "https://github.com/sumit4411suman/fitron-windows-app/releases/download/v0.1.2/FITRON-Gym-Accounting-Setup-0.1.2.exe";
  // Each test reads its own feed address, so the five-minute memory of one never answers another.
  const readFrom = (name: string) => vi.stubEnv("FITRON_WINDOWS_FEED", `https://github.com/fitron-test/${name}/releases/latest/download/latest.json`);
  // fitron.in's link: the Cloud Edition (npm run test:local runs these tests as FITRON for Windows too).
  beforeEach(() => vi.stubEnv("FITRON_EDITION", "cloud"));

  it("leads to the installer the update feed names, the one every installed FITRON updates to", async () => {
    expect(WINDOWS_FEED).toBe("https://github.com/sumit4411suman/fitron-windows-app/releases/latest/download/latest.json");
    readFrom("follows");
    answer = feed(exe);
    const res = await download();
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(exe);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(urls).toEqual(["https://github.com/fitron-test/follows/releases/latest/download/latest.json"]);
  });

  it("asks the feed at most once in five minutes", async () => {
    readFrom("kept");
    answer = feed(exe);
    const t = Date.now();
    expect(await latestWindowsInstaller(t)).toEqual({ ok: true, data: { version: "0.1.2", url: exe } });
    answer = feed(exe.replace(/0\.1\.2/g, "0.1.3"), "0.1.3");
    expect((await latestWindowsInstaller(t + 4 * 60_000)).ok && urls.length).toBe(1);
    expect(await latestWindowsInstaller(t + 6 * 60_000)).toMatchObject({ ok: true, data: { version: "0.1.3" } });
    expect(urls).toHaveLength(2);
  });

  it("never leads anywhere but an installer on the feed's own site", async () => {
    for (const [name, url] of [
      ["other-site", "https://evil.example.com/FITRON-Gym-Accounting-Setup-0.1.2.exe"],
      ["not-https", exe.replace("https:", "http:")],
      ["not-exe", exe.replace(/\.exe$/, ".zip")],
      ["no-url", undefined],
      ["broken", "not a url"],
    ] as const) {
      readFrom(name);
      answer = feed(url);
      expect(await latestWindowsInstaller(), name).toMatchObject({ ok: false, reason: "refused" });
    }
    readFrom("bad-version");
    answer = feed(exe, "0.1.2; rm");
    expect(await latestWindowsInstaller()).toMatchObject({ ok: false, reason: "refused" });
  });

  it("opens the newest release's page when the feed cannot be read, and is not part of FITRON for Windows", async () => {
    readFrom("down");
    net.up = false;
    expect((await download()).headers.get("location")).toBe(WINDOWS_RELEASES);
    net.up = true;
    answer = { status: 404, json: {} };
    readFrom("missing");
    expect((await download()).headers.get("location")).toBe(WINDOWS_RELEASES);
    vi.stubEnv("FITRON_EDITION", "local");
    expect((await download()).status).toBe(404);
  });
});
