import { describe, expect, it } from "vitest";
import { DEFAULT_IDLE_MINUTES, sessionAlive } from "./security";

const now = Date.parse("2026-10-04T10:00:00Z");
const min = (m: number) => new Date(now - m * 60_000);

describe("sessionAlive", () => {
  it("defaults to 30 minutes", () => expect(DEFAULT_IDLE_MINUTES).toBe(30));
  it("is expired past expiresAt even when active", () => expect(sessionAlive({ expiresAt: new Date(now - 1), lastSeenAt: new Date(now) }, now, 30)).toBe("expired"));
  it("is idle when lastSeenAt is older than the idle window", () => expect(sessionAlive({ expiresAt: min(-60), lastSeenAt: min(31) }, now, 30)).toBe("idle"));
  it("is ok exactly at the boundary", () => expect(sessionAlive({ expiresAt: min(-60), lastSeenAt: min(30) }, now, 30)).toBe("ok"));
  it("never idles out with 0 minutes", () => expect(sessionAlive({ expiresAt: min(-60), lastSeenAt: min(60 * 24 * 10) }, now, 0)).toBe("ok"));
});
