import "server-only";
import { formatInr } from "@/lib/domain/billing";
import { amountInWords } from "@/lib/domain/words";
import type { Paper } from "./paper";
import { footerText, rollHeader, wideHeader, type GymHeader } from "./parts";
import { INK, MUTED, Sheet, type Rendered } from "./sheet";

export type InvoicePdfData = {
  gym: GymHeader;
  number: string;
  date: string;
  dueDate: string;
  status: string;
  member: { name: string; code: string; phone: string; address?: string };
  items: { description: string; qty: number; rate: number; discount: number; taxRate: number; amount: number }[];
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  paid: number;
  balance: number;
  gstType: string | null;
  gstRate: number | null;
  payments: { code: string; date: string; method: string; amount: number; reversed: boolean }[];
  membership?: { plan: string; start: string; end: string } | null;
};

/** CGST and SGST are each half the tax (the odd paisa to SGST); IGST is all of it. */
function taxRows(d: InvoicePdfData): [string, string][] {
  if (!d.tax) return [];
  if (d.gstType === "CGST+SGST") {
    const half = Math.floor(d.tax / 2);
    return [
      [`CGST (${(d.gstRate ?? 0) / 2}%)`, formatInr(half)],
      [`SGST (${(d.gstRate ?? 0) / 2}%)`, formatInr(d.tax - half)],
    ];
  }
  return [[`IGST (${d.gstRate ?? 0}%)`, formatInr(d.tax)]];
}

/** The GST invoice: A4 or A5 for an office printer, 80 mm or 58 mm for a receipt printer. Same content as the screen. */
export async function renderInvoicePdf(d: InvoicePdfData, paper: Paper = "a4"): Promise<Rendered> {
  const s = await Sheet.create(paper, { title: `Invoice ${d.number}`, author: d.gym.name });
  const title = d.tax > 0 ? "TAX INVOICE" : "INVOICE";
  if (s.roll) roll(s, d, title);
  else await wide(s, d, title);
  return { bytes: await s.save(), lines: s.lines(), placed: s.placed, paper };
}

async function wide(s: Sheet, d: InvoicePdfData, title: string) {
  await wideHeader(s, d.gym, title, [
    ["Invoice no.", d.number],
    ["Date", d.date],
    ["Due", d.dueDate],
    ["Status", d.status],
  ]);

  // Bill to
  s.text("BILL TO", s.left, s.y, { size: s.pt(8), color: MUTED });
  s.y += s.pt(14);
  s.text(d.member.name, s.left, s.y, { size: s.pt(11), bold: true });
  s.y += s.pt(13);
  s.text(`${d.member.code} · ${d.member.phone}`, s.left, s.y, { size: s.pt(9), color: MUTED });
  for (const extra of [d.member.address, d.membership ? `Membership: ${d.membership.plan}, ${d.membership.start} to ${d.membership.end}` : ""].filter(Boolean) as string[]) {
    for (const l of s.wrap(extra, s.width, s.pt(9))) {
      s.y += s.pt(12);
      s.text(l, s.left, s.y, { size: s.pt(9), color: MUTED });
    }
  }
  s.y += s.pt(24);

  // Items. Column positions are fractions of the width, so A5 keeps A4's proportions; a description wraps in its column.
  const W = s.width;
  const cols = [
    { label: "Description", x: s.left, align: "left" as const },
    { label: "Qty", x: s.right - W * 0.5, align: "right" as const },
    { label: "Rate", x: s.right - W * 0.36, align: "right" as const },
    { label: "Discount", x: s.right - W * 0.23, align: "right" as const },
    { label: "GST", x: s.right - W * 0.14, align: "right" as const },
    { label: "Amount", x: s.right, align: "right" as const },
  ];
  const descMax = cols[1]!.x - s.left - s.pt(34);
  const header = () => {
    for (const c of cols) s.text(c.label, c.x, s.y, { size: s.pt(8), color: MUTED, align: c.align });
    s.y += s.pt(8);
    s.rule();
    s.y += s.pt(16);
  };
  header();
  for (const it of d.items) {
    const desc = s.wrap(it.description, descMax, s.pt(9.5));
    const height = desc.length * s.pt(12) + s.pt(14);
    if (s.y + height > s.pageHeight - s.spec.margin - s.pt(40)) {
      s.nextPage();
      header();
    }
    const cells = [String(it.qty), formatInr(it.rate), it.discount ? formatInr(it.discount) : "—", it.taxRate ? `${it.taxRate}%` : "—", formatInr(it.amount)];
    desc.forEach((l, i) => s.text(l, s.left, s.y + i * s.pt(12), { size: s.pt(9.5) }));
    cells.forEach((c, i) => s.text(c, cols[i + 1]!.x, s.y, { size: s.pt(9.5), align: cols[i + 1]!.align }));
    s.y += (desc.length - 1) * s.pt(12) + s.pt(10);
    s.rule();
    s.y += s.pt(16);
  }

  // Totals
  const tl = s.right - s.pt(200);
  const row = (k: string, v: string, strong = false) => {
    s.ensure(s.pt(18));
    s.text(k, tl, s.y, { size: s.pt(strong ? 11 : 9.5), bold: strong, color: strong ? INK : MUTED });
    s.text(v, s.right, s.y, { size: s.pt(strong ? 11 : 9.5), bold: strong, align: "right" });
    s.y += s.pt(strong ? 18 : 14);
  };
  row("Subtotal", formatInr(d.subtotal));
  if (d.discount) row("Discount", `− ${formatInr(d.discount)}`);
  for (const [k, v] of taxRows(d)) row(k, v);
  row("Total", formatInr(d.total), true);
  row("Paid", formatInr(d.paid));
  row("Balance due", formatInr(d.balance), true);
  s.y += s.pt(4);
  s.para(`Amount in words: ${amountInWords(d.total)}`, { size: s.pt(9), color: MUTED });

  if (d.payments.length) {
    s.y += s.pt(10);
    s.ensure(s.pt(28));
    s.text("PAYMENTS", s.left, s.y, { size: s.pt(8), color: MUTED });
    s.y += s.pt(14);
    for (const p of d.payments) {
      s.ensure(s.pt(13));
      const color = p.reversed ? MUTED : INK;
      s.text(`${p.date} · ${p.code} · ${p.method}${p.reversed ? " · reversed" : ""}`, s.left, s.y, { size: s.pt(9), color });
      s.text(formatInr(p.amount), s.left + W * 0.52, s.y, { size: s.pt(9), align: "right", color });
      s.y += s.pt(13);
    }
  }

  // Thanks and the signatory, as the prototype's invoice ends.
  s.y += s.pt(26);
  s.ensure(s.pt(40));
  s.text(`Thank you for choosing ${d.gym.name}.`, s.left, s.y, { size: s.pt(10) });
  s.line(s.right - s.pt(190), s.y + 2, s.right, s.y + 2);
  s.text(`Authorised signatory · ${d.gym.name}`, s.right, s.y + s.pt(13), { size: s.pt(8.5), color: MUTED, align: "right" });

  const footY = s.pageHeight - s.spec.margin + s.pt(10);
  if (d.gym.instagram) s.text(d.gym.instagram, s.left, footY, { size: s.pt(8), color: MUTED });
  for (const [i, l] of s.wrap(footerText(d.gym, "invoice"), d.gym.instagram ? s.width * 0.75 : s.width, s.pt(8)).entries()) {
    s.text(l, s.right, footY + i * s.pt(10), { size: s.pt(8), color: MUTED, align: "right" });
  }
}

function roll(s: Sheet, d: InvoicePdfData, title: string) {
  const small = s.pt(8.5);
  const body = s.pt(9.5);
  rollHeader(s, d.gym, title);
  s.y += s.pt(2);
  s.pair("Invoice no.", d.number, { size: body, bold: true });
  s.pair("Date", d.date, { size: body });
  s.pair("Due", d.dueDate, { size: body });
  s.pair("Status", d.status, { size: body });
  s.y += s.pt(4);
  s.rule({ dashed: true });
  s.y += s.pt(2);
  s.para(`Bill to: ${d.member.name}`, { size: body, bold: true });
  s.para(`${d.member.code} · ${d.member.phone}`, { size: small });
  if (d.membership) s.para(`Membership: ${d.membership.plan}, ${d.membership.start} to ${d.membership.end}`, { size: small });
  s.y += s.pt(4);
  s.rule({ dashed: true });
  s.y += s.pt(2);
  for (const it of d.items) {
    s.para(it.description, { size: body, bold: true });
    s.pair(`${it.qty} × ${formatInr(it.rate)}${it.taxRate ? ` · GST ${it.taxRate}%` : ""}`, formatInr(it.amount), { size: small });
    if (it.discount) s.pair("Discount", `− ${formatInr(it.discount)}`, { size: small });
    s.y += s.pt(3);
  }
  s.rule({ dashed: true });
  s.y += s.pt(2);
  s.pair("Subtotal", formatInr(d.subtotal), { size: body });
  if (d.discount) s.pair("Discount", `− ${formatInr(d.discount)}`, { size: body });
  for (const [k, v] of taxRows(d)) s.pair(k, v, { size: body });
  s.pair("Total", formatInr(d.total), { size: s.pt(11), bold: true });
  s.pair("Paid", formatInr(d.paid), { size: body });
  s.pair("Balance due", formatInr(d.balance), { size: s.pt(11), bold: true });
  s.y += s.pt(2);
  s.para(amountInWords(d.total), { size: small });
  if (d.payments.length) {
    s.y += s.pt(4);
    s.rule({ dashed: true });
    s.y += s.pt(2);
    s.para("Payments", { size: small, bold: true });
    for (const p of d.payments) s.pair(`${p.date} ${p.code} ${p.method}${p.reversed ? " (reversed)" : ""}`, formatInr(p.amount), { size: small });
  }
  s.y += s.pt(4);
  s.rule({ dashed: true });
  s.y += s.pt(2);
  s.para(`Thank you for choosing ${d.gym.name}.`, { size: body, align: "center" });
  s.para(footerText(d.gym, "invoice"), { size: s.pt(7.5), align: "center", leading: 1.25 });
}
