import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/current";
import { stepsFor } from "@/lib/domain/onboarding";
import { getOnboarding, wizardStart } from "@/lib/services/onboarding";
import { Wizard } from "./wizard";

export const metadata = { title: "Set up your gym · Fitron" };

/**
 * The first-run setup a gym that signed up on fitron.in sees before the console: eight short steps (fewer on a plan that
 * doesn't open WhatsApp, the team or the accounts). Gyms set up by hand have no setup to do and go straight to the dashboard.
 */
export default async function OnboardingPage() {
  const u = await requirePermission("settings.manage");
  const state = await getOnboarding(u.orgId);
  if (!state || state.status === "DONE") redirect("/dashboard");
  const steps = stepsFor((f) => u.has(f));
  const { form, step } = await wizardStart(u.orgId);
  // The saved step is the last one the owner got through; they carry on at the next.
  const done = step ? steps.indexOf(step) : -1;
  const start = Math.min(done + 1, steps.length - 1);
  return <Wizard steps={steps} initialForm={form} initialIndex={Math.max(0, start)} />;
}
