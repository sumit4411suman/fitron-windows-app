"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/current";
import { failed, fieldErrors, type FormState } from "@/lib/validation/common";
import { invoiceInput, paymentInput, reasonInput, sellInput } from "@/lib/validation/billing";
import { cancelInvoice, collectPayment, createInvoice, getInvoice, reversePayment, sellMembership } from "@/lib/services/billing";
import { UserError } from "@/lib/services/errors";
import { sendLater } from "@/lib/services/whatsapp";
import { rupeesText } from "@/lib/domain/whatsapp";

const read = (fd: FormData) => Object.fromEntries([...new Set(fd.keys())].map((k) => [k, fd.get(k)]));

function userError(fd: FormData, e: unknown): FormState {
  if (e instanceof UserError) return failed(fd, { message: e.message, errors: e.field ? { [e.field]: [e.message] } : undefined });
  throw e;
}

export async function sell(memberId: string, _: FormState, fd: FormData): Promise<FormState> {
  const u = await requirePermission("memberships.renew");
  const parsed = sellInput.safeParse(read(fd));
  if (!parsed.success) return failed(fd, { errors: fieldErrors(parsed.error), message: "Check the highlighted fields." });
  let invoiceId: string;
  try {
    const r = await sellMembership(u, memberId, parsed.data);
    invoiceId = r.invoice.id;
    const vars = { invoice_number: r.invoice.number, amount: rupeesText(r.invoice.total) };
    if (r.membership.type === "NEW") sendLater({ orgId: u.orgId, memberId, key: "welcome", userId: u.id, vars });
    else sendLater({ orgId: u.orgId, memberId, key: "renewal", userId: u.id, vars, invoiceId });
  } catch (e) {
    return userError(fd, e);
  }
  revalidatePath(`/members/${memberId}`);
  redirect(`/invoices/${invoiceId}?created=1`);
}

export async function newInvoice(_: FormState, fd: FormData): Promise<FormState> {
  const u = await requirePermission("invoices.create");
  // Lines arrive as parallel arrays: desc[], category[], qty[], rate[], discount[], taxable[] (index-based).
  const n = fd.getAll("desc").length;
  const lines = Array.from({ length: n }, (_, i) => ({
    description: fd.getAll("desc")[i],
    category: fd.getAll("category")[i],
    qty: fd.getAll("qty")[i],
    rate: fd.getAll("rate")[i],
    discount: fd.getAll("lineDiscount")[i],
    taxable: fd.getAll("taxable").includes(String(i)),
  })).filter((l) => String(l.description ?? "").trim() || String(l.rate ?? "").trim());
  const parsed = invoiceInput.safeParse({ ...read(fd), lines });
  if (!parsed.success) {
    const errs = fieldErrors(parsed.error);
    const lineErr = parsed.error.issues.find((i) => i.path[0] === "lines");
    return failed(fd, { errors: errs, message: lineErr ? `Line ${Number(lineErr.path[1] ?? 0) + 1}: ${lineErr.message}` : "Check the highlighted fields." });
  }
  let id: string;
  try {
    const inv = await createInvoice(u, parsed.data);
    id = inv.id;
    sendLater({ orgId: u.orgId, memberId: inv.memberId, key: "invoice", userId: u.id, vars: { invoice_number: inv.number, amount: rupeesText(inv.total) }, invoiceId: inv.id });
  } catch (e) {
    return userError(fd, e);
  }
  revalidatePath("/invoices");
  redirect(`/invoices/${id}?created=1`);
}

export async function collect(invoiceId: string, _: FormState, fd: FormData): Promise<FormState> {
  const u = await requirePermission("payments.collect");
  const parsed = paymentInput.safeParse(read(fd));
  if (!parsed.success) return failed(fd, { errors: fieldErrors(parsed.error), message: "Check the highlighted fields." });
  try {
    const p = await collectPayment(u, invoiceId, parsed.data);
    const inv = await getInvoice(u, invoiceId);
    sendLater({ orgId: u.orgId, memberId: p.memberId, key: "payment", userId: u.id, vars: { amount: rupeesText(p.amount), invoice_number: inv?.number ?? "", pending_amount: rupeesText(inv?.balance ?? 0) } });
  } catch (e) {
    return userError(fd, e);
  }
  revalidatePath(`/invoices/${invoiceId}`);
  return { ok: true, message: "Payment recorded.", nonce: Math.random().toString(36) };
}

export async function cancel(invoiceId: string, _: FormState, fd: FormData): Promise<FormState> {
  const u = await requirePermission("invoices.cancel");
  const parsed = reasonInput.safeParse(read(fd));
  if (!parsed.success) return failed(fd, { errors: fieldErrors(parsed.error) });
  try {
    await cancelInvoice(u, invoiceId, parsed.data.reason);
  } catch (e) {
    return userError(fd, e);
  }
  revalidatePath(`/invoices/${invoiceId}`);
  return { ok: true, message: "Invoice cancelled. Its payments were reversed.", nonce: Math.random().toString(36) };
}

export async function reverse(paymentId: string, invoiceId: string, _: FormState, fd: FormData): Promise<FormState> {
  const u = await requirePermission("payments.reverse");
  const parsed = reasonInput.safeParse(read(fd));
  if (!parsed.success) return failed(fd, { errors: fieldErrors(parsed.error) });
  try {
    await reversePayment(u, paymentId, parsed.data.reason);
  } catch (e) {
    return userError(fd, e);
  }
  revalidatePath(`/invoices/${invoiceId}`);
  return { ok: true, message: "Payment reversed.", nonce: Math.random().toString(36) };
}
