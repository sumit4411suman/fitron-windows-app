import "server-only";
import { rgb } from "pdf-lib";
import { formatInr } from "@/lib/domain/billing";
import { amountInWords } from "@/lib/domain/words";
import type { Paper } from "./paper";
import { footerText, rollHeader, wideHeader, type GymHeader } from "./parts";
import { GOLD, INK, LINE, MUTED, Sheet, type Rendered } from "./sheet";

// The payment receipt: proof that a payment was received, handed to the member at the desk (thermal) or kept on file
// (A5, A4). It names the invoice it pays, what that invoice was for (the membership and its dates), and what is still
// due after it. A payment that was reversed prints as CANCELLED with the reason, never as a valid receipt.

export type ReceiptPdfData = {
  gym: GymHeader;
  /** The payment's code, PAY-5001: the receipt number. */
  number: string;
  date: string;
  member: { name: string; code: string; phone: string };
  amount: number;
  method: string;
  txnRef?: string | null;
  notes?: string | null;
  invoice: { number: string; date: string; total: number; paidToDate: number; balance: number };
  membership?: { plan: string; start: string; end: string } | null;
  items: { description: string; qty: number; amount: number }[];
  receivedBy: string;
  reversed?: { date: string; reason: string } | null;
};

const RED = rgb(0.7, 0.1, 0.08);

export async function renderReceiptPdf(d: ReceiptPdfData, paper: Paper = "80mm"): Promise<Rendered> {
  const s = await Sheet.create(paper, { title: `Receipt ${d.number}`, author: d.gym.name });
  if (s.roll) roll(s, d);
  else await wide(s, d);
  return { bytes: await s.save(), lines: s.lines(), placed: s.placed, paper };
}

const towards = (d: ReceiptPdfData) =>
  d.membership ? `${d.membership.plan} membership, ${d.membership.start} to ${d.membership.end}` : d.items.map((i) => (i.qty > 1 ? `${i.description} × ${i.qty}` : i.description)).join(", ");

async function wide(s: Sheet, d: ReceiptPdfData) {
  await wideHeader(s, d.gym, d.reversed ? "RECEIPT · CANCELLED" : "PAYMENT RECEIPT", [
    ["Receipt no.", d.number],
    ["Date", d.date],
    ["Invoice", d.invoice.number],
  ]);
  if (d.reversed) {
    s.para(`CANCELLED: this payment was reversed on ${d.reversed.date}. ${d.reversed.reason}`, { size: s.pt(11), bold: true, color: RED });
    s.y += s.pt(8);
  }

  s.text("RECEIVED FROM", s.left, s.y, { size: s.pt(8), color: MUTED });
  s.y += s.pt(14);
  s.text(d.member.name, s.left, s.y, { size: s.pt(12), bold: true });
  s.y += s.pt(13);
  s.text(`${d.member.code} · ${d.member.phone}`, s.left, s.y, { size: s.pt(9), color: MUTED });
  s.y += s.pt(18);

  // The amount, boxed.
  const box = s.pt(54);
  s.rect(s.left, s.y, s.width, box, rgb(0.98, 0.96, 0.9));
  s.text("Amount received", s.left + s.pt(14), s.y + s.pt(20), { size: s.pt(9), color: MUTED });
  s.text(formatInr(d.amount), s.right - s.pt(14), s.y + s.pt(24), { size: s.pt(20), bold: true, align: "right", color: d.reversed ? MUTED : INK });
  const words = s.wrap(amountInWords(d.amount), s.width - s.pt(28) - s.measure(formatInr(d.amount), s.pt(20), true) - s.pt(12), s.pt(9));
  words.slice(0, 2).forEach((w, i) => s.text(w, s.left + s.pt(14), s.y + s.pt(34) + i * s.pt(11), { size: s.pt(9), color: GOLD }));
  s.y += box + s.pt(22);

  const row = (k: string, v: string) => {
    const lines = s.wrap(v, s.width * 0.68, s.pt(10));
    s.ensure(lines.length * s.pt(14) + s.pt(6));
    s.text(k, s.left, s.y, { size: s.pt(9.5), color: MUTED });
    lines.forEach((l, i) => s.text(l, s.right, s.y + i * s.pt(14), { size: s.pt(10), align: "right" }));
    s.y += lines.length * s.pt(14) + s.pt(4);
    s.rule({ y: s.y - s.pt(10), color: LINE });
    s.y += s.pt(6);
  };
  row("Payment mode", d.method);
  if (d.txnRef) row("Reference", d.txnRef);
  row("Towards", towards(d) || `Invoice ${d.invoice.number}`);
  row("Against invoice", `${d.invoice.number} of ${d.invoice.date}`);
  row("Invoice total", formatInr(d.invoice.total));
  row("Paid to date", formatInr(d.invoice.paidToDate));
  row("Balance due", formatInr(d.invoice.balance));
  if (d.notes) row("Note", d.notes);
  row("Received by", d.receivedBy);

  s.y += s.pt(26);
  s.ensure(s.pt(40));
  s.text(`Thank you, ${d.member.name}.`, s.left, s.y, { size: s.pt(10) });
  s.line(s.right - s.pt(190), s.y + 2, s.right, s.y + 2);
  s.text(`For ${d.gym.name}`, s.right, s.y + s.pt(13), { size: s.pt(8.5), color: MUTED, align: "right" });
  const footY = s.pageHeight - s.spec.margin + s.pt(10);
  for (const [i, l] of s.wrap(footerText(d.gym, "receipt"), s.width, s.pt(8)).entries()) s.text(l, s.right, footY + i * s.pt(10), { size: s.pt(8), color: MUTED, align: "right" });
}

function roll(s: Sheet, d: ReceiptPdfData) {
  const small = s.pt(8.5);
  const body = s.pt(9.5);
  rollHeader(s, d.gym, d.reversed ? "RECEIPT · CANCELLED" : "PAYMENT RECEIPT");
  if (d.reversed) s.para(`CANCELLED: reversed on ${d.reversed.date}. ${d.reversed.reason}`, { size: body, bold: true, align: "center" });
  s.y += s.pt(2);
  s.pair("Receipt no.", d.number, { size: body, bold: true });
  s.pair("Date", d.date, { size: body });
  s.y += s.pt(4);
  s.rule({ dashed: true });
  s.y += s.pt(2);
  s.para(`Received from: ${d.member.name}`, { size: body, bold: true });
  s.para(`${d.member.code} · ${d.member.phone}`, { size: small });
  s.y += s.pt(4);
  s.rule({ dashed: true });
  s.y += s.pt(4);
  s.pair("AMOUNT", formatInr(d.amount), { size: s.pt(13), bold: true });
  s.para(amountInWords(d.amount), { size: small });
  s.y += s.pt(2);
  s.pair("Mode", d.method, { size: body });
  if (d.txnRef) s.pair("Ref", d.txnRef, { size: small });
  s.y += s.pt(4);
  s.rule({ dashed: true });
  s.y += s.pt(2);
  const t = towards(d);
  if (t) s.para(`Towards: ${t}`, { size: small });
  s.pair("Invoice", d.invoice.number, { size: small });
  s.pair("Invoice total", formatInr(d.invoice.total), { size: small });
  s.pair("Paid to date", formatInr(d.invoice.paidToDate), { size: small });
  s.pair("Balance due", formatInr(d.invoice.balance), { size: body, bold: true });
  if (d.notes) s.para(`Note: ${d.notes}`, { size: small });
  s.y += s.pt(4);
  s.rule({ dashed: true });
  s.y += s.pt(2);
  s.para(`Received by ${d.receivedBy}`, { size: small, align: "center" });
  s.para(`Thank you, ${d.member.name}.`, { size: body, align: "center" });
  s.para(footerText(d.gym, "receipt"), { size: s.pt(7.5), align: "center", leading: 1.25 });
}
