import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { formatInr } from "@/lib/domain/billing";
import { gymInitials } from "@/lib/domain/tax";

const FONT_DIR = path.join(process.cwd(), "node_modules/dejavu-fonts-ttf/ttf");
let fonts: Promise<[Uint8Array, Uint8Array]> | undefined;
const loadFonts = () =>
  (fonts ??= Promise.all([readFile(path.join(FONT_DIR, "DejaVuSans.ttf")), readFile(path.join(FONT_DIR, "DejaVuSans-Bold.ttf"))]));

export type InvoicePdfData = {
  gym: {
    name: string;
    tagline?: string;
    address: string;
    phone: string;
    email?: string;
    gstin?: string | null;
    sac?: string;
    instagram?: string;
    /** The uploaded gym logo; without one a monogram block is drawn. */
    logo?: { bytes: Uint8Array; mime: "image/png" | "image/jpeg" } | null;
  };
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

const INK = rgb(0.12, 0.11, 0.08);
const MUTED = rgb(0.43, 0.4, 0.34);
const GOLD = rgb(0.54, 0.4, 0.07);
const LINE = rgb(0.89, 0.88, 0.85);
const DARK = rgb(0.125, 0.118, 0.114);
const MONO_GOLD = rgb(0.94, 0.83, 0.53);

/** A4 GST invoice. Same content as the invoice screen. */
export async function renderInvoicePdf(d: InvoicePdfData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const [regBytes, boldBytes] = await loadFonts();
  const reg = await doc.embedFont(regBytes, { subset: true });
  const bold = await doc.embedFont(boldBytes, { subset: true });
  doc.setTitle(`Invoice ${d.number}`);
  doc.setAuthor(d.gym.name);

  let page = doc.addPage([595.28, 841.89]);
  const M = 48;
  const W = page.getWidth() - M * 2;
  let y = page.getHeight() - M;

  const text = (p: PDFPage, s: string, x: number, yy: number, o: { font?: PDFFont; size?: number; color?: ReturnType<typeof rgb>; align?: "left" | "right" } = {}) => {
    const font = o.font ?? reg;
    const size = o.size ?? 10;
    const w = font.widthOfTextAtSize(s, size);
    p.drawText(s, { x: o.align === "right" ? x - w : x, y: yy, size, font, color: o.color ?? INK });
  };

  // Header: the gym's logo (or a monogram), its name and tagline, with the From lines under them.
  const LOGO = 64;
  let logoDrawn = false;
  if (d.gym.logo) {
    try {
      const img = d.gym.logo.mime === "image/png" ? await doc.embedPng(d.gym.logo.bytes) : await doc.embedJpg(d.gym.logo.bytes);
      const fit = Math.min(LOGO / img.width, LOGO / img.height);
      const w = img.width * fit;
      const h = img.height * fit;
      page.drawImage(img, { x: M + (LOGO - w) / 2, y: y - LOGO + (LOGO - h) / 2, width: w, height: h });
      logoDrawn = true;
    } catch {
      // An image pdf-lib can't read: fall back to the monogram.
    }
  }
  if (!logoDrawn) {
    page.drawRectangle({ x: M, y: y - LOGO, width: LOGO, height: LOGO, color: DARK, borderWidth: 0 });
    const mono = gymInitials(d.gym.name);
    const mw = bold.widthOfTextAtSize(mono, 24);
    text(page, mono, M + (LOGO - mw) / 2, y - LOGO / 2 - 8, { font: bold, size: 24, color: MONO_GOLD });
  }
  const nx = M + LOGO + 14;
  const name = d.gym.name.toUpperCase();
  text(page, name, nx, y - 18, { font: bold, size: 18 });
  if (d.gym.tagline) text(page, d.gym.tagline, nx, y - 32, { size: 8, color: GOLD });
  text(page, d.tax > 0 ? "TAX INVOICE" : "INVOICE", M + W, y - 2, { font: bold, size: 12, color: GOLD, align: "right" });
  y -= LOGO + 14;
  const contact = [d.gym.phone ? `Phone ${d.gym.phone}` : "", d.gym.email ?? ""].filter(Boolean).join(" · ");
  for (const l of [...d.gym.address.split(/\r?\n/).map((x) => x.trim()), contact, d.gym.gstin ? `GSTIN ${d.gym.gstin}` : ""].filter(Boolean)) {
    text(page, l, M, y, { size: 9, color: MUTED });
    y -= 12;
  }
  let ry = page.getHeight() - M - 20;
  for (const [k, v] of [["Invoice no.", d.number], ["Date", d.date], ["Due", d.dueDate], ["Status", d.status]]) {
    text(page, k, M + W - 110, ry, { size: 9, color: MUTED });
    text(page, v, M + W, ry, { size: 9, font: bold, align: "right" });
    ry -= 12;
  }
  y = Math.min(y, ry) - 16;

  // Bill to
  text(page, "BILL TO", M, y, { size: 8, color: MUTED });
  y -= 14;
  text(page, d.member.name, M, y, { font: bold, size: 11 });
  y -= 13;
  text(page, `${d.member.code} · ${d.member.phone}`, M, y, { size: 9, color: MUTED });
  if (d.member.address) {
    y -= 12;
    text(page, d.member.address, M, y, { size: 9, color: MUTED });
  }
  if (d.membership) {
    y -= 12;
    text(page, `Membership: ${d.membership.plan}, ${d.membership.start} to ${d.membership.end}`, M, y, { size: 9, color: MUTED });
  }
  y -= 24;

  // Items
  const cols = [
    { label: "Description", x: M, align: "left" as const },
    { label: "Qty", x: M + W - 250, align: "right" as const },
    { label: "Rate", x: M + W - 180, align: "right" as const },
    { label: "Discount", x: M + W - 115, align: "right" as const },
    { label: "GST", x: M + W - 70, align: "right" as const },
    { label: "Amount", x: M + W, align: "right" as const },
  ];
  const rule = (yy: number) => page.drawLine({ start: { x: M, y: yy }, end: { x: M + W, y: yy }, thickness: 0.7, color: LINE });
  for (const c of cols) text(page, c.label, c.x, y, { size: 8, color: MUTED, align: c.align });
  y -= 8;
  rule(y);
  y -= 16;
  for (const it of d.items) {
    if (y < 160) {
      page = doc.addPage([595.28, 841.89]);
      y = page.getHeight() - M;
    }
    const cells = [it.description, String(it.qty), formatInr(it.rate), it.discount ? formatInr(it.discount) : "—", it.taxRate ? `${it.taxRate}%` : "—", formatInr(it.amount)];
    cells.forEach((c, i) => text(page, c, cols[i]!.x, y, { size: 9.5, align: cols[i]!.align }));
    y -= 10;
    rule(y);
    y -= 16;
  }

  // Totals
  const tl = M + W - 200;
  const row = (k: string, v: string, strong = false) => {
    text(page, k, tl, y, { size: strong ? 11 : 9.5, font: strong ? bold : reg, color: strong ? INK : MUTED });
    text(page, v, M + W, y, { size: strong ? 11 : 9.5, font: strong ? bold : reg, align: "right" });
    y -= strong ? 18 : 14;
  };
  row("Subtotal", formatInr(d.subtotal));
  if (d.discount) row("Discount", `− ${formatInr(d.discount)}`);
  if (d.tax) {
    if (d.gstType === "CGST+SGST") {
      const half = Math.floor(d.tax / 2);
      row(`CGST (${(d.gstRate ?? 0) / 2}%)`, formatInr(half));
      row(`SGST (${(d.gstRate ?? 0) / 2}%)`, formatInr(d.tax - half));
    } else row(`IGST (${d.gstRate ?? 0}%)`, formatInr(d.tax));
  }
  row("Total", formatInr(d.total), true);
  row("Paid", formatInr(d.paid));
  row("Balance due", formatInr(d.balance), true);

  if (d.payments.length) {
    y -= 10;
    text(page, "PAYMENTS", M, y, { size: 8, color: MUTED });
    y -= 14;
    for (const p of d.payments) {
      text(page, `${p.date} · ${p.code} · ${p.method}${p.reversed ? " · reversed" : ""}`, M, y, { size: 9, color: p.reversed ? MUTED : INK });
      text(page, formatInr(p.amount), M + 260, y, { size: 9, align: "right", color: p.reversed ? MUTED : INK });
      y -= 13;
    }
  }

  // Thanks and the signatory, as the prototype's invoice ends.
  y -= 26;
  if (y < M + 40) {
    page = doc.addPage([595.28, 841.89]);
    y = page.getHeight() - M;
  }
  text(page, `Thank you for choosing ${d.gym.name}.`, M, y, { size: 10 });
  page.drawLine({ start: { x: M + W - 190, y: y - 2 }, end: { x: M + W, y: y - 2 }, thickness: 0.7, color: INK });
  text(page, `Authorised signatory · ${d.gym.name}`, M + W, y - 13, { size: 8.5, color: MUTED, align: "right" });

  const foot = d.gym.sac ? `SAC ${d.gym.sac} · ` : "";
  if (d.gym.instagram) text(page, d.gym.instagram, M, M - 10, { size: 8, color: MUTED });
  text(page, `${foot}Computer-generated invoice · no signature required · Powered by Fitron`, M + W, M - 10, { size: 8, color: MUTED, align: "right" });
  return doc.save();
}
