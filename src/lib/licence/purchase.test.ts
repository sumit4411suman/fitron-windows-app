import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { newSigningKey, signLicence } from "./issue";
import type { Licence } from "./licence";

// A licence bought on fitron.in, from this computer's side (src/lib/licence/purchase.ts).
const ask = vi.hoisted(() => vi.fn());
vi.mock("@/lib/integrations/license", () => ({ collectBoughtLicence: ask }));
const key = vi.hoisted(() => ({ trusted: [] as { id: string; publicKey: string }[] }));
vi.mock("./keys", () => ({ get FITRON_LICENCE_KEYS() { return key.trusted; } }));

const { buyLink, collectPurchase, markOpened, readPurchase, waitingPurchase } = await import("./purchase");

let root: string;
const signing = newSigningKey("fitron-online-test");
const licence = (over: Partial<Licence> = {}): Licence => ({ v: 1, licenceId: "FITW-2026-ABC", keyId: signing.trusted.id, licensee: "Iron Gym", plan: "professional", edition: "local", branches: 1, installationId: "inst-12345678", issuedOn: "2026-10-12", expiresOn: "2027-10-11", graceDays: 15, ...over });

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "fitron-purchase-"));
  vi.stubEnv("FITRON_SECRETS", "");
  vi.stubEnv("FITRON_CLOUD_URL", "https://fitron.in");
  writeFileSync(path.join(root, "secrets.json"), JSON.stringify({ installationId: "inst-12345678", createdAt: "2026-10-01T06:00:00.000Z" }));
  key.trusted = [signing.trusted];
  ask.mockReset();
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

describe("buying a licence on fitron.in", () => {
  it("opens fitron.in's buy page with this computer's id and a one-time claim, the same until it is used", () => {
    const url = new URL(buyLink(root, "2026-10-12")!);
    expect(url.origin + url.pathname).toBe("https://fitron.in/windows/buy");
    expect(url.searchParams.get("i")).toBe("inst-12345678");
    const claim = url.searchParams.get("c")!;
    expect(claim).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(new URL(buyLink(root, "2026-10-12")!).searchParams.get("c")).toBe(claim);
    // Not waiting until the owner actually opens the page.
    expect(waitingPurchase(root)).toBeNull();
    markOpened(root);
    expect(waitingPurchase(root)?.claim).toBe(claim);
  });

  it("collects the licence once paid, installs it, and forgets the claim", async () => {
    buyLink(root, "2026-10-12");
    const claim = readPurchase(root)!.claim;
    ask.mockResolvedValueOnce({ ok: true, data: { status: "pending" } });
    expect(await collectPurchase(root, "2026-10-12")).toMatchObject({ state: "waiting" });
    expect(ask).toHaveBeenCalledWith("inst-12345678", claim);

    ask.mockResolvedValueOnce({ ok: true, data: { status: "paid", licence: signLicence(licence(), signing.privatePem) } });
    expect(await collectPurchase(root, "2026-10-12")).toMatchObject({ state: "installed", licenceId: "FITW-2026-ABC" });
    expect(readFileSync(path.join(root, "licence.fitronlicence"), "utf8")).toMatch(/^FITRON-LICENCE-1\./);
    expect(existsSync(path.join(root, "licence-purchase.json"))).toBe(false);
  });

  it("refuses a licence made for another computer, and keeps the claim to try again", async () => {
    buyLink(root, "2026-10-12");
    ask.mockResolvedValueOnce({ ok: true, data: { status: "paid", licence: signLicence(licence({ installationId: "another-computer" }), signing.privatePem) } });
    const r = await collectPurchase(root, "2026-10-12");
    expect(r).toMatchObject({ state: "problem" });
    expect(r.message).toMatch(/another computer/);
    expect(existsSync(path.join(root, "licence.fitronlicence"))).toBe(false);
    expect(readPurchase(root)).not.toBeNull();
  });

  it("waits quietly while offline, or while the licence is being prepared", async () => {
    buyLink(root, "2026-10-12");
    ask.mockResolvedValueOnce({ ok: false, reason: "offline", message: "This computer is offline." });
    expect(await collectPurchase(root, "2026-10-12")).toMatchObject({ state: "offline" });
    ask.mockResolvedValueOnce({ ok: true, data: { status: "preparing" } });
    expect(await collectPurchase(root, "2026-10-12")).toMatchObject({ state: "preparing" });
    expect(readPurchase(root)).not.toBeNull();
  });

  it("has nothing to collect before Buy was pressed", async () => {
    expect(await collectPurchase(root, "2026-10-12")).toMatchObject({ state: "none" });
    expect(ask).not.toHaveBeenCalled();
  });
});
