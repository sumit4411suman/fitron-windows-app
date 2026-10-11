import { notFound, redirect } from "next/navigation";
import { isLocal } from "@/lib/runtime/edition";
import { localSetupNeeded } from "@/lib/services/local-setup";
import { LocalAuthShell } from "@/app/login/local-shell";
import { RecoverForm } from "./recover-form";

export const metadata = { title: "Reset the owner's password · FITRON" };
export const dynamic = "force-dynamic";

// Owner password reset without email (Local Edition). Staff passwords are reset by a Super Admin from Staff.
export default async function RecoverPage() {
  if (!isLocal()) notFound();
  if (await localSetupNeeded()) redirect("/setup");
  return (
    <LocalAuthShell title="Reset the owner's password" lead="Use the recovery key you saved when FITRON was set up. Staff members: ask the owner to reset your password from Staff.">
      <RecoverForm />
    </LocalAuthShell>
  );
}
