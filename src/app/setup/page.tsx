import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current";
import { isLocal } from "@/lib/runtime/edition";
import { localSetupNeeded } from "@/lib/services/local-setup";
import { LocalAuthShell } from "@/app/login/local-shell";
import { SetupForm } from "./setup-form";

export const metadata = { title: "Set up FITRON" };
export const dynamic = "force-dynamic";

// First run of FITRON on a computer (Local Edition). The Cloud Edition has no such page: gyms sign up on fitron.in.
export default async function SetupPage() {
  if (!isLocal()) notFound();
  // Once the gym exists this page is closed, except to show the recovery key to the owner who just created it
  // (the form keeps it in its own state, so a reload lands on the dashboard).
  if (!(await localSetupNeeded())) redirect((await getCurrentUser()) ? "/dashboard" : "/login");
  return (
    <LocalAuthShell title="Set up FITRON on this computer" lead="Create your gym and your owner login. Everything is kept on this computer, and works without the internet.">
      <SetupForm />
    </LocalAuthShell>
  );
}
