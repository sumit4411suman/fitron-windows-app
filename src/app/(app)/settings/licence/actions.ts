"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/current";
import { db } from "@/lib/db";
import { audit } from "@/lib/services/audit";
import { collectThisPurchase, importThisLicence, markThisPurchaseOpened } from "@/lib/licence";
import { isLocal } from "@/lib/runtime/edition";

const back = (p: Record<string, string>): never => redirect(`/settings/licence?${new URLSearchParams(p)}`);

/** Settings › Licence › Import: the licence file FITRON sent, or its text pasted. Checked on this computer, no internet. */
export async function importLicenceAction(fd: FormData) {
  // Open when the licence has ended: importing a new one is how a gym gets going again.
  const u = await requirePermission("settings.manage", { allowBlocked: true });
  if (!isLocal()) back({ error: "Licences are for FITRON for Windows." });
  const file = fd.get("file");
  let text = String(fd.get("text") ?? "").trim();
  if (file instanceof File && file.size > 0) {
    if (file.size > 16_384) back({ error: "That is not a FITRON licence file: it is too big." });
    text = (await file.text()).trim();
  }
  if (!text) back({ error: "Choose the licence file FITRON sent, or paste its text." });
  const r = importThisLicence(text);
  if (!r.ok) back({ error: r.reason });
  if (r.ok) {
    await db.$transaction((tx) => audit(tx, { orgId: u.orgId, userId: u.id, action: "licence.import", entity: "Licence", entityId: r.licence.licenceId, after: { licensee: r.licence.licensee, plan: r.licence.plan, branches: r.licence.branches, expiresOn: r.licence.expiresOn } }));
    revalidatePath("/", "layout");
    back({ imported: r.licence.licenceId });
  }
}

/** Settings › Licence › Buy or renew: the owner opened fitron.in's buy page; FITRON now looks for the licence. */
export async function markBuyOpenedAction() {
  await requirePermission("settings.manage", { allowBlocked: true });
  if (isLocal()) markThisPurchaseOpened();
}

/** Asks fitron.in for the licence bought there, and installs it once paid. Called while the page waits, and by Check now. */
export async function collectLicenceAction() {
  const u = await requirePermission("settings.manage", { allowBlocked: true });
  if (!isLocal()) return { state: "problem" as const, message: "Licences are for FITRON for Windows." };
  const r = await collectThisPurchase();
  if (r.state === "installed") {
    await db.$transaction((tx) => audit(tx, { orgId: u.orgId, userId: u.id, action: "licence.bought", entity: "Licence", entityId: r.licenceId, after: { licenceId: r.licenceId } }));
    revalidatePath("/", "layout");
  }
  return r;
}
