"use server";

import { headers } from "next/headers";
import { formAction } from "@/lib/form-action";
import { rateLimit } from "@/lib/rate-limit";
import { createContactMessage, createTrialRequest } from "@/lib/services/enquiries";
import { failed, type FormState } from "@/lib/validation/common";
import { contactSchema, trialRequestSchema } from "@/lib/validation/site";

// Bots fill the hidden "website" field; people never see it. Each address may send 5 forms in 10 minutes.
async function guard(fd: FormData): Promise<FormState | null> {
  if (String(fd.get("website") ?? "")) return { ok: true, message: "Thanks, we've got it." };
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (!rateLimit(`site:${ip}`, 5, 10 * 60_000)) return failed(fd, { message: "That's a lot of messages in a few minutes. Wait a little and try again." });
  return null;
}

export async function requestTrial(_: FormState, fd: FormData): Promise<FormState> {
  return (
    (await guard(fd)) ??
    formAction(fd, trialRequestSchema, createTrialRequest, "Thanks, your request is in. We'll call or WhatsApp you within one working day to set up your account.")
  );
}

export async function sendContact(_: FormState, fd: FormData): Promise<FormState> {
  return (await guard(fd)) ?? formAction(fd, contactSchema, createContactMessage, "Thanks, your message is in. We reply within one working day, Monday to Saturday.");
}
