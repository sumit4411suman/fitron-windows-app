import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current";
import { isLocal } from "@/lib/runtime/edition";
import { takeRecoveryKey } from "@/lib/services/local-setup";
import { LocalAuthShell } from "@/app/login/local-shell";
import { RecoveryKey } from "./recovery-key";

export const metadata = { title: "Your recovery key · FITRON" };
export const dynamic = "force-dynamic";

// Shown once, right after first-run setup, to the owner who just created the gym. A reload or a second visit has no key
// to show and goes on to the console.
export default async function RecoveryKeyPage() {
  if (!isLocal()) notFound();
  const u = await getCurrentUser();
  if (!u) redirect("/login");
  const key = takeRecoveryKey(u.id);
  if (!key) redirect("/dashboard");
  return (
    <LocalAuthShell
      title="Save your recovery key"
      lead="This key is the only way to reset the owner's password on this computer if it is forgotten. FITRON keeps no copy and cannot show it again. Write it down or print it, and keep it somewhere safe, away from the computer."
    >
      <RecoveryKey value={key} />
    </LocalAuthShell>
  );
}
