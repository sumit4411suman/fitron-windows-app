import "server-only";
import { db } from "@/lib/db";
import type { GoogleProfile } from "@/lib/integrations/google";
import { findOrCreateTrainer } from "./trainer";
import { createTrainerSession } from "./trainer-session";

/** Whether this email already has an AI Trainer account (deleted accounts keep no email, so they don't count). */
export async function hasTrainerAccount(email: string): Promise<boolean> {
  return !!(await db.trainerMember.findUnique({ where: { email: email.trim().toLowerCase() }, select: { id: true } }));
}

/**
 * Google confirmed the email (called by the shared Google callback for ?for=trainer): find or create
 * the AI Trainer account for it and sign it in with the trainer cookie. The app then opens on
 * onboarding for a new account, or the dashboard for an existing one.
 */
export async function signInTrainerWithGoogle(me: Pick<GoogleProfile, "email" | "name"> & Partial<GoogleProfile>): Promise<void> {
  const m = await findOrCreateTrainer(me.email, "GOOGLE", me.name ?? "");
  await createTrainerSession(m.id);
}
