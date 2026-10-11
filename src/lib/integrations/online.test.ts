import { createServer, type AddressInfo } from "node:net";
import { networkInterfaces } from "node:os";
import { describe, expect, it } from "vitest";
import { UserError } from "@/lib/services/errors";
import { isNetworkError, offlineMessage, online, OfflineError, OFFLINE_MESSAGE, probablyOnline } from "./online";

describe("online services", () => {
  it("tells a network failure from a service's own refusal", () => {
    const fetchFailed = Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("getaddrinfo ENOTFOUND api.anthropic.com"), { code: "ENOTFOUND" }) });
    expect(isNetworkError(fetchFailed)).toBe(true);
    expect(isNetworkError(Object.assign(new Error("connect"), { code: "ECONNREFUSED" }))).toBe(true);
    expect(isNetworkError(Object.assign(new Error("x"), { name: "TimeoutError" }))).toBe(true);
    expect(isNetworkError(Object.assign(new Error("Invalid login: 535 Authentication failed"), { code: "EAUTH" }))).toBe(false);
    expect(isNetworkError(new Error("Razorpay 400: amount must be at least 100"))).toBe(false);
  });

  it("turns 'no internet' into a clear message and leaves other errors alone", async () => {
    await expect(online("Sending WhatsApp messages", () => Promise.reject(Object.assign(new Error("x"), { code: "ENOTFOUND" })))).rejects.toThrow(UserError);
    await expect(online("Sending WhatsApp messages", () => Promise.reject(Object.assign(new Error("x"), { code: "ENOTFOUND" })))).rejects.toThrow(OfflineError);
    await expect(online("Sending WhatsApp messages", () => Promise.reject(Object.assign(new Error("x"), { code: "ENOTFOUND" })))).rejects.toThrow(/^Sending WhatsApp messages requires an internet connection\./);
    await expect(online("AI", () => Promise.reject(new Error("401 invalid key")))).rejects.toThrow("401 invalid key");
    await expect(online("AI", async () => 42)).resolves.toBe(42);
    expect(offlineMessage()).toContain(OFFLINE_MESSAGE);
  });

  it("checks the host a feature will use: one connection, within 1.5 seconds, remembered for 30 seconds", async () => {
    // A mail server on the gym's own network: this machine's own network address (not loopback, so it is really checked).
    const lan = Object.values(networkInterfaces()).flat().find((i) => i && i.family === "IPv4" && !i.internal)?.address;
    expect(await probablyOnline({ host: "127.0.0.1", port: 9 }), "this computer is always there").toBe(true);
    expect(await probablyOnline({ host: "no-such-host.invalid", port: 443 }, 1_000)).toBe(false);
    if (!lan) return;
    const server = createServer((c) => c.end());
    await new Promise<void>((r) => server.listen(0, "0.0.0.0", r));
    const target = { host: lan, port: (server.address() as AddressInfo).port };
    expect(await probablyOnline(target, 1_000)).toBe(true);
    await new Promise<void>((r) => server.close(() => r()));
    expect(await probablyOnline(target, 2_000), "remembered").toBe(true);
    expect(await probablyOnline(target, 40_000), "asked again after 30 s: nothing answers now").toBe(false);
  });
});

