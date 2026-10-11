import "server-only";
import { gymInitials } from "@/lib/domain/tax";
import { DARK, GOLD, MONO_GOLD, MUTED, type Sheet } from "./sheet";

// What every FITRON document starts with: who it is from. Wide (A4, A5) and roll (thermal) versions.

export type GymHeader = {
  name: string;
  tagline?: string;
  address: string;
  phone: string;
  email?: string;
  gstin?: string | null;
  sac?: string;
  instagram?: string;
  /** The uploaded gym logo; without one a monogram block is drawn on paper (not on a roll). */
  logo?: { bytes: Uint8Array; mime: "image/png" | "image/jpeg" } | null;
};

const contactLine = (g: GymHeader) => [g.phone ? `Phone ${g.phone}` : "", g.email ?? ""].filter(Boolean).join(" · ");
const addressLines = (g: GymHeader) => g.address.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);

/**
 * A4/A5: logo or monogram, the gym's name and tagline, its address, contact and GSTIN; the document's title and
 * key facts (number, date…) on the right. Leaves the cursor under whichever is longer.
 */
export async function wideHeader(s: Sheet, g: GymHeader, title: string, facts: [string, string][]) {
  const top = s.y;
  const LOGO = s.pt(64);
  let drawn = false;
  if (g.logo) drawn = await s.image(g.logo.bytes, g.logo.mime, s.left, top, LOGO);
  if (!drawn) {
    s.rect(s.left, top, LOGO, LOGO, DARK);
    s.text(gymInitials(g.name), s.left + LOGO / 2, top + LOGO / 2 + s.pt(8), { size: s.pt(24), bold: true, color: MONO_GOLD, align: "center" });
  }
  const nx = s.left + LOGO + s.pt(14);
  const factsWidth = s.pt(170);
  // The name gets the room the facts column leaves; a long name wraps.
  const nameLines = s.wrap(g.name.toUpperCase(), s.right - factsWidth - nx - s.pt(8), s.pt(18), true);
  let ny = top + s.pt(18);
  for (const l of nameLines) {
    s.text(l, nx, ny, { size: s.pt(18), bold: true });
    ny += s.pt(20);
  }
  if (g.tagline) s.text(g.tagline, nx, ny - s.pt(6), { size: s.pt(8), color: GOLD });
  s.text(title, s.right, top + s.pt(10), { size: s.pt(12), bold: true, color: GOLD, align: "right" });
  let ry = top + s.pt(28);
  for (const [k, v] of facts) {
    s.text(k, s.right - factsWidth, ry, { size: s.pt(9), color: MUTED });
    s.text(v, s.right, ry, { size: s.pt(9), bold: true, align: "right" });
    ry += s.pt(12);
  }
  s.y = Math.max(top + LOGO, ny) + s.pt(14);
  const from = [...addressLines(g), contactLine(g), g.gstin ? `GSTIN ${g.gstin}` : ""].filter(Boolean);
  for (const l of from) {
    for (const w of s.wrap(l, s.right - factsWidth - s.left - s.pt(8), s.pt(9))) {
      s.text(w, s.left, s.y, { size: s.pt(9), color: MUTED });
      s.y += s.pt(12);
    }
  }
  s.y = Math.max(s.y, ry) + s.pt(10);
}

/** Thermal: everything centred, one column; the logo is left out (thermal printers print it badly). */
export function rollHeader(s: Sheet, g: GymHeader, title: string) {
  s.para(g.name.toUpperCase(), { size: s.pt(13), bold: true, align: "center" });
  if (g.tagline) s.para(g.tagline, { size: s.pt(8), align: "center" });
  for (const l of addressLines(g)) s.para(l, { size: s.pt(8.5), align: "center", leading: 1.25 });
  const c = contactLine(g);
  if (c) s.para(c, { size: s.pt(8.5), align: "center", leading: 1.25 });
  if (g.gstin) s.para(`GSTIN ${g.gstin}`, { size: s.pt(8.5), align: "center", bold: true });
  s.y += s.pt(4);
  s.rule({ dashed: true });
  s.y += s.pt(2);
  s.para(title, { size: s.pt(11), bold: true, align: "center" });
}

/** The closing lines every document ends with. */
export function footerText(g: GymHeader, what: "invoice" | "receipt") {
  return `${g.sac ? `SAC ${g.sac} · ` : ""}Computer-generated ${what} · no signature required · Powered by Fitron`;
}

