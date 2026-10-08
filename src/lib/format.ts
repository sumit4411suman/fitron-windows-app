export { formatInr } from "@/lib/domain/billing";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-09-27" or a Date → "27 Sep 2026" */
export function fmtDate(d: string | Date | null | undefined) {
  if (!d) return "—";
  const s = typeof d === "string" ? d : d.toISOString().slice(0, 10);
  const [y, m, day] = s.split("-");
  return `${Number(day)} ${MONTHS[Number(m) - 1]} ${y}`;
}

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

/** A timestamp as Indian clock time, "6:05 pm". */
export const fmtTime = (d: Date | null | undefined) =>
  d ? d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" }) : "—";

/** "18:30" → "6:30 pm" */
export function fmtClock(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  return `${((h! + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h! < 12 ? "am" : "pm"}`;
}

/** The Indian calendar date of a timestamp, "28 Sep 2026" (fmtDate reads @db.Date columns as-is). */
export const fmtStamp = (d: Date | null | undefined) => (d ? fmtDate(new Date(d.getTime() + 330 * 60_000)) : "—");

/** Paise as whole rupees for summary figures, as the prototype shows them: "₹33,300", "−₹7,215". */
export const formatRupees = (paise: number) => `${paise < 0 ? "−" : ""}₹${Math.round(Math.abs(paise) / 100).toLocaleString("en-IN")}`;

/** "2026-10-02" → "2 Oct" */
export function fmtShort(d: string | Date | null | undefined) {
  if (!d) return "—";
  const s = typeof d === "string" ? d : d.toISOString().slice(0, 10);
  return `${Number(s.slice(8, 10))} ${MONTHS[Number(s.slice(5, 7)) - 1]}`;
}

/** "2026-10" → "Oct" */
export const fmtMonthShort = (ym: string) => MONTHS[Number(ym.slice(5, 7)) - 1]!;
