"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/current";
import { db } from "@/lib/db";
import { memberInput } from "@/lib/validation/member";
import { failed, fieldErrors, type FormState } from "@/lib/validation/common";
import { simpleAction } from "@/lib/form-action";
import { checkPhoto, createMember, deleteMember, removeMemberPhoto, restoreMember, setMemberPhoto, setSuspended, updateMember } from "@/lib/services/members";
import { UserError } from "@/lib/services/errors";
import { freezeMembership, transferMember, unfreezeMembership } from "@/lib/services/freeze";
import { sendTemplate } from "@/lib/services/whatsapp";
import { rupeesText } from "@/lib/domain/whatsapp";
import { fmtDate } from "@/lib/format";
import { enrol, eraseBiometrics } from "@/lib/services/biometric";
import { DOC_KINDS, deleteDocument, replaceDocument, uploadDocument } from "@/lib/services/documents";

const read = (fd: FormData) => Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === "string"));

async function handle(fd: FormData, fn: () => Promise<unknown>): Promise<FormState> {
  try {
    await fn();
    return { ok: true };
  } catch (e) {
    if (e instanceof UserError) return failed(fd, { message: e.message, errors: e.field ? { [e.field]: [e.message] } : undefined });
    throw e;
  }
}

export async function saveMember(id: string | null, _: FormState, fd: FormData): Promise<FormState> {
  const u = await requirePermission(id ? "members.edit" : "members.create");
  const parsed = memberInput.safeParse(read(fd));
  if (!parsed.success) return failed(fd, { errors: fieldErrors(parsed.error), message: "Check the highlighted fields." });
  let newId = id;
  const photoEntry = fd.get("photo");
  const photo = photoEntry instanceof File && photoEntry.size > 0 ? photoEntry : null;
  const res = await handle(fd, async () => {
    if (photo) await checkPhoto(photo);
    if (id) await updateMember(u, id, parsed.data);
    else newId = (await createMember(u, parsed.data, { leadId: (fd.get("leadId") as string) || undefined })).id;
    if (id && fd.get("removePhoto") === "on" && !photo) await removeMemberPhoto(u, id);
    if (photo) await setMemberPhoto(u, newId!, photo);
  });
  if (!res?.ok) return res;
  revalidatePath("/members");
  redirect(`/members/${newId}`);
}

export async function toggleSuspend(id: string, suspend: boolean) {
  const u = await requirePermission("members.edit");
  await setSuspended(u, id, suspend);
  revalidatePath(`/members/${id}`);
}

export async function changeMemberPhoto(memberId: string, _: FormState, fd: FormData): Promise<FormState> {
  const u = await requirePermission("members.edit");
  const r =
    fd.get("intent") === "remove"
      ? await simpleAction(() => removeMemberPhoto(u, memberId), "Photo removed.")
      : await simpleAction(() => setMemberPhoto(u, memberId, fd.get("photo") as File), "Photo updated.");
  revalidatePath(`/members/${memberId}`);
  return r;
}

export async function removeMember(id: string, fd: FormData) {
  const u = await requirePermission("members.delete");
  const reason = String(fd.get("reason") ?? "").trim();
  const name = (await db.member.findFirst({ where: { id, orgId: u.orgId }, select: { name: true } }))?.name ?? "Member";
  try {
    await deleteMember(u, id, reason);
  } catch (e) {
    if (e instanceof UserError) redirect(`/members/${id}?${new URLSearchParams({ do: "delete", err: e.message })}`);
    throw e;
  }
  revalidatePath("/members");
  redirect(`/members?${new URLSearchParams({ msg: `${name} deleted. Restore from Recently deleted.` })}`);
}

export async function bringBackMember(id: string) {
  const u = await requirePermission("members.delete");
  try {
    await restoreMember(u, id);
  } catch (e) {
    if (e instanceof UserError) redirect(`/members?deleted=1&error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  revalidatePath("/members");
  redirect(`/members/${id}`);
}

export async function enrolBiometric(id: string, fd: FormData) {
  const u = await requirePermission("members.edit");
  const kind = fd.get("kind") === "FACE" ? "FACE" : "FP";
  let error = "";
  try {
    await enrol(u, id, String(fd.get("deviceId") ?? ""), kind, fd.get("consent") === "on");
  } catch (e) {
    if (!(e instanceof UserError)) throw e;
    error = e.message;
  }
  revalidatePath(`/members/${id}`);
  redirect(`/members/${id}?${new URLSearchParams(error ? { bioError: error } : { bio: kind === "FP" ? "Ask the member to place their finger on the device three times." : "Ask the member to look at the device." })}#biometric`);
}

export async function eraseBiometric(id: string) {
  const u = await requirePermission("members.edit");
  await eraseBiometrics(u, id);
  revalidatePath(`/members/${id}`);
  redirect(`/members/${id}?${new URLSearchParams({ bio: "Biometric data deleted here and removed from every device." })}#biometric`);
}

const docBack = (id: string, p: Record<string, string>): never => redirect(`/members/${id}?${new URLSearchParams(p)}#documents`);

async function docAction(memberId: string, fn: () => Promise<unknown>, ok: string) {
  try {
    await fn();
  } catch (e) {
    if (e instanceof UserError) docBack(memberId, { docError: e.message });
    throw e;
  }
  revalidatePath(`/members/${memberId}`);
  docBack(memberId, { doc: ok });
}

export async function uploadDocumentAction(memberId: string, fd: FormData) {
  const u = await requirePermission("documents.manage");
  const kind = String(fd.get("kind") ?? "");
  const title = String(fd.get("title") ?? "").trim().slice(0, 80);
  if (!(DOC_KINDS as readonly string[]).includes(kind)) docBack(memberId, { docError: "Pick what kind of document it is." });
  await docAction(memberId, () => uploadDocument(u, memberId, { kind, title: title || kind }, fd.get("file") as File), "Document saved.");
}

export async function replaceDocumentAction(memberId: string, docId: string, fd: FormData) {
  const u = await requirePermission("documents.manage");
  await docAction(memberId, () => replaceDocument(u, docId, fd.get("file") as File), "Document replaced. The old file is kept in the history.");
}

export async function deleteDocumentAction(memberId: string, docId: string, fd: FormData) {
  const u = await requirePermission("documents.manage");
  await docAction(memberId, () => deleteDocument(u, docId, String(fd.get("reason") ?? "")), "Document removed. It stays in the history.");
}

/** After a profile action: back to the profile with the result shown at the top. */
function backToProfile(id: string, msg: string, tab?: string): never {
  revalidatePath(`/members/${id}`);
  redirect(`/members/${id}?${new URLSearchParams({ ...(tab ? { tab } : {}), msg })}`);
}

async function profileAction(id: string, fn: () => Promise<string>, failTo?: string) {
  let msg: string;
  try {
    msg = await fn();
  } catch (e) {
    if (!(e instanceof UserError)) throw e;
    if (failTo) redirect(`/members/${id}?${new URLSearchParams({ do: failTo, err: e.message })}`);
    msg = e.message;
  }
  backToProfile(id, msg);
}

export async function freezeAction(id: string, fd: FormData) {
  const u = await requirePermission("memberships.renew");
  await profileAction(
    id,
    async () => {
      const r = await freezeMembership(u, id, { days: Number(fd.get("days")), from: String(fd.get("from") ?? ""), reason: String(fd.get("reason") ?? "Other") });
      return `Membership frozen for ${r.freeze.days} days. End date moved to ${fmtDate(r.newEnd)}.`;
    },
    "freeze",
  );
}

export async function unfreezeAction(id: string) {
  const u = await requirePermission("memberships.renew");
  await profileAction(id, async () => {
    const r = await unfreezeMembership(u, id);
    return `Unfrozen. ${r.returned} unused day${r.returned === 1 ? "" : "s"} taken off; membership now ends ${fmtDate(r.newEnd)}.`;
  });
}

export async function transferAction(id: string, fd: FormData) {
  const u = await requirePermission("members.edit");
  await profileAction(
    id,
    async () => {
      const to = String(fd.get("to") ?? "");
      await transferMember(u, id, to, String(fd.get("reason") ?? "").trim() || undefined);
      return `Moved to ${u.branches.find((b) => b.id === to)?.name}. Past invoices stay with the old branch.`;
    },
    "transfer",
  );
}

export async function sendInvoiceWaAction(id: string, invoiceId: string, number: string, total: number) {
  const u = await requirePermission("whatsapp.send");
  await profileAction(id, async () => {
    const sent = await sendTemplate({ orgId: u.orgId, memberId: id, key: "invoice", userId: u.id, invoiceId, vars: { invoice_number: number, amount: rupeesText(total) } });
    return sent?.status === "Failed" ? `Invoice ${number} could not be sent: ${sent.error}` : `Invoice ${number} sent on WhatsApp.`;
  });
}
