// The papers FITRON prints on (docs/local-windows/PRINTING.md). Sizes in PDF points (1/72 inch).
//   A4, A5         office printers: invoices, and receipts for a file
//   80 mm, 58 mm   thermal receipt printers: the roll is cut where the receipt ends, so the page is as tall as its content.
// Thermal margins leave the printable width of each roll (about 72 mm and 48 mm).

export type Paper = "a4" | "a5" | "80mm" | "58mm";

export type PaperSpec = {
  label: string;
  width: number;
  /** Fixed page height; null for a roll, cut to the content. */
  height: number | null;
  margin: number;
  /** Type size relative to A4. */
  scale: number;
};

const MM = 72 / 25.4;

export const PAPERS: Record<Paper, PaperSpec> = {
  a4: { label: "A4", width: 595.28, height: 841.89, margin: 48, scale: 1 },
  a5: { label: "A5", width: 419.53, height: 595.28, margin: 30, scale: 0.8 },
  "80mm": { label: "80 mm receipt", width: 80 * MM, height: null, margin: 4 * MM, scale: 0.9 },
  "58mm": { label: "58 mm receipt", width: 58 * MM, height: null, margin: 5 * MM, scale: 0.78 },
};

export const PAPER_LIST = Object.keys(PAPERS) as Paper[];

export const isRoll = (p: Paper) => PAPERS[p].height === null;

/** A paper named in a request (`?paper=a5`), or the fallback for anything else. */
export function parsePaper(value: string | null | undefined, fallback: Paper): Paper {
  return value && (PAPER_LIST as string[]).includes(value) ? (value as Paper) : fallback;
}
