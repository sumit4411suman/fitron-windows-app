"use server";

import { headers } from "next/headers";
import { rateLimit } from "@/lib/rate-limit";
import { UserError } from "@/lib/services/errors";
import { confirmWindowsLicenceCheckout, confirmWindowsLicenceDemo, startWindowsLicence, type WindowsCheckout } from "@/lib/services/windows-licence";
import { log } from "@/lib/log";

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

async function ip() {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
}

async function run<T>(what: string, f: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, data: await f() };
  } catch (e) {
    if (e instanceof UserError) return { ok: false, error: e.message };
    log.error(`windows_licence.${what}`, e);
    return { ok: false, error: "Something went wrong. Nothing was charged; try again in a minute, or write to hello@fitron.in." };
  }
}

/** The buy page's Pay button: an order, and what Razorpay Checkout needs. */
export async function startWindowsLicenceAction(input: { installationId: string; claim: string; plan: string; cycle: string; licensee: string; email: string; phone: string; gstin: string }): Promise<Result<WindowsCheckout>> {
  if (!rateLimit(`windows-buy:${await ip()}`, 20, 10 * 60_000)) return { ok: false, error: "Too many tries. Wait a few minutes and try again." };
  return run("start", () => startWindowsLicence(input));
}

/** Checkout's success handler. */
export async function confirmWindowsLicenceAction(a: { orderId: string; paymentId: string; signature: string }) {
  return run("confirm", () => confirmWindowsLicenceCheckout(a));
}

/** Development only (no Razorpay keys on this server). */
export async function confirmWindowsLicenceDemoAction(id: string) {
  return run("demo", async () => ({ paid: (await confirmWindowsLicenceDemo(id))?.status === "PAID" }));
}
