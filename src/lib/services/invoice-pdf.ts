import "server-only";
import type { CurrentUser } from "@/lib/auth/current";
import { getInvoice } from "./billing";
import { getGymProfile } from "./settings";
import { getTax } from "./tax";
import { readGymLogo } from "./gym-logo";
import { renderInvoicePdf } from "@/lib/pdf/invoice";
import { fmtDate } from "@/lib/format";
import { INVOICE_STATUS_LABEL } from "@/components/invoice-status";

/** The A4 GST invoice as PDF bytes, or null if the user can't see it. */
export async function invoicePdf(u: CurrentUser, id: string) {
  const inv = await getInvoice(u, id);
  if (!inv) return null;
  const [gym, tax, logo] = await Promise.all([getGymProfile(u.orgId), getTax(u.orgId), readGymLogo(u.orgId).catch(() => null)]);
  const m = inv.member;
  const bytes = await renderInvoicePdf({
    gym: {
      name: gym.name || inv.org.name,
      tagline: gym.tagline || undefined,
      address: gym.address || inv.branch.address,
      phone: gym.phone || inv.branch.phone,
      email: gym.email || undefined,
      // A branch's own registration wins; else the gym-level one from Billing & GST.
      gstin: inv.branch.gstin || tax.gstin || null,
      sac: tax.sac,
      instagram: gym.instagram || undefined,
      logo: logo && (logo.mime === "image/png" || logo.mime === "image/jpeg") ? { bytes: logo.body, mime: logo.mime } : null,
    },
    number: inv.number,
    date: fmtDate(inv.date),
    dueDate: fmtDate(inv.dueDate),
    status: INVOICE_STATUS_LABEL[inv.status],
    member: { name: m.name, code: m.code, phone: m.phone, address: [m.house, m.area, m.city, m.state, m.pin].filter(Boolean).join(", ") },
    items: inv.items.map((i) => ({ ...i, taxRate: Number(i.taxRate) })),
    subtotal: inv.subtotal,
    discount: inv.discount,
    tax: inv.tax,
    total: inv.total,
    paid: inv.paid,
    balance: inv.balance,
    gstType: inv.gstType,
    gstRate: inv.gstRate ? Number(inv.gstRate) : null,
    payments: inv.payments.map((p) => ({ code: p.code, date: fmtDate(p.date), method: p.method, amount: p.amount, reversed: p.status === "REVERSED" })),
    membership: inv.membership ? { plan: inv.membership.plan.name, start: fmtDate(inv.membership.startDate), end: fmtDate(inv.membership.endDate) } : null,
  });
  return { bytes, filename: `${inv.number}.pdf`, invoice: inv };
}
