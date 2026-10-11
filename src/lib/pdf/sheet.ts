import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { PAPERS, type Paper, type PaperSpec } from "./paper";

// A page to print on, measured from the top (y grows downwards), for FITRON's invoices and receipts. It draws with
// pdf-lib and keeps a record of every piece of text it placed, so tests can read what a document says and check that
// nothing runs off the paper. A thermal roll is drawn on one tall page and cut to the content at the end.

const FONT_DIR = path.join(process.cwd(), "node_modules/dejavu-fonts-ttf/ttf");
let fonts: Promise<[Uint8Array, Uint8Array]> | undefined;
const loadFonts = () => (fonts ??= Promise.all([readFile(path.join(FONT_DIR, "DejaVuSans.ttf")), readFile(path.join(FONT_DIR, "DejaVuSans-Bold.ttf"))]));

export const INK = rgb(0.12, 0.11, 0.08);
export const MUTED = rgb(0.43, 0.4, 0.34);
export const GOLD = rgb(0.54, 0.4, 0.07);
export const LINE = rgb(0.89, 0.88, 0.85);
export const DARK = rgb(0.125, 0.118, 0.114);
export const MONO_GOLD = rgb(0.94, 0.83, 0.53);
// Thermal printers print black or nothing: no greys on a roll.
export const BLACK = rgb(0, 0, 0);

const ROLL = 14_400; // 5 metres of paper is room enough for any receipt.

export type Placed = { page: number; text: string; x: number; y: number; width: number; size: number; bold: boolean };
export type TextOptions = { size?: number; bold?: boolean; color?: RGB; align?: "left" | "right" | "center" };

export class Sheet {
  readonly spec: PaperSpec;
  readonly placed: Placed[] = [];
  private pages: PDFPage[] = [];
  /** The cursor: distance from the top of the current page. */
  y: number;

  private constructor(
    readonly doc: PDFDocument,
    readonly paper: Paper,
    private readonly reg: PDFFont,
    private readonly boldFont: PDFFont,
  ) {
    this.spec = PAPERS[paper];
    this.addPage();
    this.y = this.spec.margin;
  }

  static async create(paper: Paper, meta: { title: string; author: string }): Promise<Sheet> {
    const doc = await PDFDocument.create();
    doc.registerFontkit(fontkit);
    const [r, b] = await loadFonts();
    const reg = await doc.embedFont(r, { subset: true });
    const bold = await doc.embedFont(b, { subset: true });
    doc.setTitle(meta.title);
    doc.setAuthor(meta.author);
    doc.setCreator("FITRON");
    doc.setProducer("FITRON");
    return new Sheet(doc, paper, reg, bold);
  }

  get roll() {
    return this.spec.height === null;
  }
  get page() {
    return this.pages[this.pages.length - 1]!;
  }
  get pageHeight() {
    return this.spec.height ?? ROLL;
  }
  get left() {
    return this.spec.margin;
  }
  get right() {
    return this.spec.width - this.spec.margin;
  }
  get width() {
    return this.right - this.left;
  }
  /** A type size for this paper: `s` is the A4 size. */
  pt(s: number) {
    return Math.round(s * this.spec.scale * 10) / 10;
  }

  private addPage() {
    this.pages.push(this.doc.addPage([this.spec.width, this.pageHeight]));
    this.y = this.spec.margin;
  }

  /** A new page (never on a roll). */
  nextPage() {
    if (!this.roll) this.addPage();
  }

  /** Starts a new page when `space` more points would not fit (never on a roll). */
  ensure(space: number) {
    if (!this.roll && this.y + space > this.pageHeight - this.spec.margin) this.addPage();
  }

  font(bold = false) {
    return bold ? this.boldFont : this.reg;
  }

  measure(s: string, size: number, bold = false) {
    return this.font(bold).widthOfTextAtSize(s, size);
  }

  /** Text with its baseline at `y` (from the top). `x` is the left edge, or the right edge / centre when aligned so. */
  text(s: string, x: number, y: number, o: TextOptions = {}) {
    const size = o.size ?? this.pt(10);
    const bold = !!o.bold;
    const w = this.measure(s, size, bold);
    const left = o.align === "right" ? x - w : o.align === "center" ? x - w / 2 : x;
    this.page.drawText(s, { x: left, y: this.pageHeight - y, size, font: this.font(bold), color: o.color ?? (this.roll ? BLACK : INK) });
    this.placed.push({ page: this.pages.length, text: s, x: left, y, width: w, size, bold });
    return w;
  }

  /** Splits text into lines no wider than `max`, at spaces where it can and inside a word only when it must. */
  wrap(s: string, max: number, size: number, bold = false): string[] {
    const out: string[] = [];
    for (const para of s.split(/\r?\n/)) {
      let line = "";
      for (const word of para.split(/\s+/).filter(Boolean)) {
        const next = line ? `${line} ${word}` : word;
        if (this.measure(next, size, bold) <= max) {
          line = next;
          continue;
        }
        if (line) out.push(line);
        line = "";
        let rest = word;
        while (this.measure(rest, size, bold) > max) {
          let n = rest.length - 1;
          while (n > 1 && this.measure(rest.slice(0, n), size, bold) > max) n--;
          out.push(rest.slice(0, n));
          rest = rest.slice(n);
        }
        line = rest;
      }
      out.push(line);
    }
    return out;
  }

  /** Wrapped text from the cursor, moving it down; returns the lines drawn. */
  para(s: string, o: TextOptions & { x?: number; max?: number; leading?: number } = {}) {
    const size = o.size ?? this.pt(10);
    const x = o.x ?? (o.align === "right" ? this.right : o.align === "center" ? this.left + this.width / 2 : this.left);
    const lines = this.wrap(s, o.max ?? this.width, size, o.bold);
    for (const l of lines) {
      this.ensure(size * 1.4);
      this.y += size * 1.05;
      this.text(l, x, this.y, o);
      this.y += size * ((o.leading ?? 1.35) - 1.05);
    }
    return lines;
  }

  /** A label on the left and a value on the right of one line; the label wraps if both do not fit. */
  pair(label: string, value: string, o: { size?: number; bold?: boolean; color?: RGB } = {}) {
    const size = o.size ?? this.pt(10);
    const vw = this.measure(value, size, o.bold);
    const lines = this.wrap(label, Math.max(this.width - vw - size, this.width / 3), size, o.bold);
    this.ensure(size * 1.4 * lines.length);
    lines.forEach((l, i) => {
      this.y += size * 1.05;
      this.text(l, this.left, this.y, { size, bold: o.bold, color: o.color });
      if (i === 0) this.text(value, this.right, this.y, { size, bold: o.bold, align: "right", color: o.color });
      this.y += size * 0.3;
    });
  }

  rule(o: { y?: number; thickness?: number; color?: RGB; dashed?: boolean } = {}) {
    const y = this.pageHeight - (o.y ?? this.y);
    this.page.drawLine({
      start: { x: this.left, y },
      end: { x: this.right, y },
      thickness: o.thickness ?? (this.roll ? 0.8 : 0.7),
      color: o.color ?? (this.roll ? BLACK : LINE),
      dashArray: o.dashed ? [2, 2] : undefined,
    });
  }

  line(x1: number, y1: number, x2: number, y2: number, o: { thickness?: number; color?: RGB } = {}) {
    this.page.drawLine({ start: { x: x1, y: this.pageHeight - y1 }, end: { x: x2, y: this.pageHeight - y2 }, thickness: o.thickness ?? 0.7, color: o.color ?? INK });
  }

  rect(x: number, yTop: number, w: number, h: number, color: RGB) {
    this.page.drawRectangle({ x, y: this.pageHeight - yTop - h, width: w, height: h, color, borderWidth: 0 });
  }

  async image(bytes: Uint8Array, mime: "image/png" | "image/jpeg", x: number, yTop: number, box: number): Promise<boolean> {
    try {
      const img = mime === "image/png" ? await this.doc.embedPng(bytes) : await this.doc.embedJpg(bytes);
      const fit = Math.min(box / img.width, box / img.height);
      const w = img.width * fit;
      const h = img.height * fit;
      this.page.drawImage(img, { x: x + (box - w) / 2, y: this.pageHeight - yTop - box + (box - h) / 2, width: w, height: h });
      return true;
    } catch {
      // An image pdf-lib can't read.
      return false;
    }
  }

  /** The finished PDF. A roll is cut below the last line, with a little paper left to tear against. */
  async save(): Promise<Uint8Array> {
    if (this.roll) {
      const used = Math.ceil(this.y + this.spec.margin * 2);
      // Show only the top `used` points of the tall page: what the printer feeds and cuts.
      this.page.setMediaBox(0, ROLL - used, this.spec.width, used);
      this.page.setCropBox(0, ROLL - used, this.spec.width, used);
    }
    return this.doc.save();
  }

  /** Every line of text placed, in reading order per page (tests). */
  lines(): string[] {
    const rows = new Map<string, Placed[]>();
    for (const p of this.placed) {
      const key = `${p.page}:${Math.round(p.y)}`;
      rows.set(key, [...(rows.get(key) ?? []), p]);
    }
    return [...rows.entries()]
      .sort(([a], [b]) => {
        const [pa, ya] = a.split(":").map(Number);
        const [pb, yb] = b.split(":").map(Number);
        return pa! - pb! || ya! - yb!;
      })
      .map(([, ps]) => ps.sort((p, q) => p.x - q.x).map((p) => p.text).join(" "));
  }
}

export type Rendered = { bytes: Uint8Array; lines: string[]; placed: Placed[]; paper: Paper };
