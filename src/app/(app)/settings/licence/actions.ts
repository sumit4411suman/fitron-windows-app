"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/current";
import { db } from "@/lib/db";
import { audit } from "@/lib/services/audit";
import { collectThisPurchase, importThisLicence, markThisPurchaseOpened, thisBuyLink } from "@/lib/licence";
import { isLocal } from "@/lib/runtime/edition";
import { openInBrowser } from "@/lib/runtime/open-in-browser";
import { log } from "@/lib/log";

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

/**
 * Settings › Licence › Buy or renew: the buy page's address, which the page then opens. In FITRON for Windows the shell
 * shows it in FITRON's own payment window (src-tauri/src/main.rs), so the gym pays without leaving FITRON. FITRON then
 * looks for the licence.
 */
export async function startBuyAction(): Promise<{ url: string | null }> {
  await requirePermission("settings.manage", { allowBlocked: true });
  if (!isLocal()) return { url: null };
  const url = thisBuyLink();
  if (url) markThisPurchaseOpened();
  return { url };
}

/**
 * "Pay in my browser instead": opens fitron.in's buy page in the computer's own browser (from FITRON's server, on
 * this computer), and FITRON then looks for the licence. `opened` false: the browser could not be started, and the page
 * shows the address to copy instead.
 */
export async function openBuyAction(): Promise<{ opened: boolean; url: string | null }> {
  await requirePermission("settings.manage", { allowBlocked: true });
  if (!isLocal()) return { opened: false, url: null };
  const url = thisBuyLink();
  if (!url) return { opened: false, url: null };
  markThisPurchaseOpened();
  const opened = await openInBrowser(url);
  // In logs\server.log, for support: whether the browser was started (never the address, which holds the claim).
  log.info("licence.buy_open", { opened });
  return { opened, url };
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
