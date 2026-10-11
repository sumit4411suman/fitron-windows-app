import type { ReactNode } from "react";
import { cx } from "./ui";

/** The prototype's five tag styles (fitron-core.js TGS): filled gold, gold outline, pink outline, filled pink, strong pink outline. */
const STYLES = [
  "border-transparent bg-accent-soft text-accent-strong",
  "border-accent-500 text-accent-700",
  "border-alert-300 text-alert-700",
  "border-transparent bg-alert-soft text-alert-strong",
  "border-alert-400 text-alert-700",
] as const;
const NEUTRAL = "border-transparent bg-neutral-200 text-neutral-800";

/** Which style each status label takes (fitron-core.js TG). */
const STYLE_OF: Record<string, number> = {
  ACTIVE: 0, PAID: 0, Locked: 1, Online: 0, Allowed: 0, Granted: 0, Offline: 2, Refused: 3, Denied: 3, Read: 0, Success: 0, Active: 0, Won: 0, Attended: 0, "In stock": 0, Paid: 0, Due: 4, Booked: 0, Inside: 0,
  "EXPIRING SOON": 1, "STARTS LATER": 1, Delivered: 1, Sent: 1, Medium: 1, "Trial booked": 1, Waitlist: 1, Contacted: 1,
  "PARTIALLY PAID": 2, "PART PAID": 2, "Trial done": 2, Paused: 2,
  EXPIRED: 3, Deactivated: 3, Failed: 3, Halted: 3, OVERDUE: 3, Full: 3, "No-show": 3, "Low stock": 3, "High risk": 3, High: 3,
  "PAYMENT PENDING": 4, UNPAID: 4, "DUE TODAY": 4, "Medium risk": 4, New: 4,
};

/** `style` forces one of the five styles (0-4) or "neutral" where the prototype colours by something other than the label. */
export function Tag({ label, children, className, style }: { label: string; children?: ReactNode; className?: string; style?: 0 | 1 | 2 | 3 | 4 | "neutral" }) {
  const i = style === "neutral" ? undefined : (style ?? STYLE_OF[label]);
  return (
    <span className={cx("inline-flex items-center rounded-[1.5px] border px-2.5 py-[3px] text-[11px] tracking-[0.02em] whitespace-nowrap", i === undefined ? NEUTRAL : STYLES[i], className)}>
      {children ?? label}
    </span>
  );
}
