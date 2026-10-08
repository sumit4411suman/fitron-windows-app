"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/current";
import { simpleAction } from "@/lib/form-action";
import type { FormState } from "@/lib/validation/common";
import { confirmProposal, dismissProposal } from "@/lib/services/ai";
import { computeRisk } from "@/lib/services/insights";
import { getWaSettings } from "@/lib/services/whatsapp";

type Done = NonNullable<FormState> & { href?: string; pdf?: string };

export async function sendProposalAction(id: string): Promise<Done | undefined> {
  const u = await requirePermission("ai.use");
  let msg = "";
  let href: string | undefined;
  let pdf: string | undefined;
  const r = await simpleAction(async () => {
    const res = await confirmProposal(u, id);
    if (res.kind === "ACTION") {
      msg = res.message;
      href = res.href;
      pdf = res.pdf;
      return;
    }
    const mode = (await getWaSettings(u.orgId)).mode;
    msg = `${res.sent} ${mode === "demo" ? "logged (demo mode, not sent)" : mode === "connector" ? "queued on the linked phone" : "sent"}${res.failed ? `, ${res.failed} failed` : ""}.`;
  }, "");
  if (r?.ok) {
    // An accounting draft changes the books, so every page that reads them is stale.
    for (const path of ["/whatsapp", "/invoices", "/payments", "/receivables", "/expenses", "/accounting", "/dashboard", "/members", "/reports"]) revalidatePath(path);
  }
  return r?.ok ? { ...r, message: msg, href, pdf } : r;
}

export async function dismissProposalAction(id: string): Promise<FormState> {
  const u = await requirePermission("ai.use");
  return simpleAction(() => dismissProposal(u, id), "Dismissed.");
}

export async function refreshRiskAction() {
  const u = await requirePermission("members.view");
  await computeRisk(u.orgId);
  revalidatePath("/ai");
}
