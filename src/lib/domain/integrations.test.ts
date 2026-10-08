import { describe, expect, it } from "vitest";
import { autopayStatusText, DEFAULT_AI, deviceStatusText, withAiDefaults, withAutopayDefaults } from "./integrations";

describe("Settings › Integrations & AI texts", () => {
  it("autopay status: demo, unchecked, reachable with/without webhook, unreachable", () => {
    expect(autopayStatusText({}, "demo")).toBe("Demo mode: debits are simulated inside Fitron. Nothing to test.");
    expect(autopayStatusText({}, "live")).toBe("Not checked yet");
    const checkedAt = "2026-10-04T04:35:00.000Z";
    expect(autopayStatusText({ connOk: true, webhookOk: true, checkedAt }, "live")).toMatch(/^Razorpay reachable · keys set · webhook secret set · checked 4 Oct 2026, 10:05 am$/);
    expect(autopayStatusText({ connOk: true, webhookOk: false, checkedAt }, "live")).toMatch(/^Razorpay reachable · keys set · webhook secret missing · checked /);
    expect(autopayStatusText({ connOk: false, error: "Authentication failed", checkedAt }, "live")).toMatch(/^Razorpay not reachable: Authentication failed · checked /);
    expect(autopayStatusText({ connOk: false, error: "RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are not set on the server." }, "live")).toBe("Razorpay not reachable: RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are not set on the server.");
  });

  it("autopay defaults and clamping", () => {
    expect(withAutopayDefaults(null)).toEqual({ mode: "demo", retries: 3, retryGap: 2 });
    expect(withAutopayDefaults({ mode: "live", retries: 99, retryGap: 0, connOk: true })).toMatchObject({ mode: "live", retries: 10, retryGap: 1, connOk: true });
  });

  it("device status: online within 5 minutes, offline after, waiting without a sync", () => {
    const now = new Date("2026-10-04T06:00:00.000Z");
    expect(deviceStatusText({ lastSeenAt: new Date(now.getTime() - 60_000) }, now)).toBe("Online · last sync 1 min ago");
    expect(deviceStatusText({ lastSeenAt: new Date(now.getTime() - 30_000) }, now)).toBe("Online · last sync just now");
    expect(deviceStatusText({ lastSeenAt: new Date(now.getTime() - 2 * 3_600_000) }, now)).toBe("Offline · last seen 4 Oct 2026, 9:30 am");
    expect(deviceStatusText({ lastSeenAt: null }, now)).toBe("Waiting for first connection");
  });

  it("AI defaults: assistant and brief on, win-back off; partial rows keep the rest", () => {
    expect(withAiDefaults(null)).toEqual({ enabled: true, dailyBrief: true, autoWinback: false });
    expect(withAiDefaults({})).toEqual(DEFAULT_AI);
    expect(withAiDefaults({ enabled: false })).toEqual({ enabled: false, dailyBrief: true, autoWinback: false });
    expect(withAiDefaults({ autoWinback: true })).toEqual({ enabled: true, dailyBrief: true, autoWinback: true });
  });
});
