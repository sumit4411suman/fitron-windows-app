"use server";

import { headers } from "next/headers";
import { rateLimit } from "@/lib/rate-limit";
import { UserError } from "@/lib/services/errors";
import { selfCheckIn, type SelfCheckIn } from "@/lib/services/self-checkin";

export type CheckInState = (SelfCheckIn | { status: "error"; message: string }) & { phone?: string } | undefined;

/**
 * The public check-in form. Anyone who knows a member's mobile number could check them in, so the page is limited: a
 * busy gym shares one address (its Wi-Fi), so each address may try 60 times in 10 minutes, but one number only 5 times.
 */
export async function checkInAction(branchId: string, _: CheckInState, fd: FormData): Promise<CheckInState> {
  const phone = String(fd.get("phone") ?? "").slice(0, 30);
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const digits = phone.replace(/\D/g, "").slice(-10);
  if (!rateLimit(`checkin-ip:${ip}`, 60, 10 * 60_000) || !rateLimit(`checkin:${branchId}:${digits}`, 5, 10 * 60_000)) {
    return { status: "error", message: "Too many tries. Wait a few minutes, or ask at the front desk.", phone };
  }
  try {
    return { ...(await selfCheckIn(branchId, phone)), phone };
  } catch (e) {
    if (e instanceof UserError) return { status: "error", message: e.message, phone };
    throw e;
  }
}
