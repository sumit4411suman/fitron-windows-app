import type { InvoiceStatus } from "@/lib/domain/billing";
import { Tag } from "./tag";

const LABEL: Record<InvoiceStatus, string> = { PAID: "Paid", PARTIALLY_PAID: "Partially paid", UNPAID: "Unpaid", CANCELLED: "Cancelled" };
const TAG: Record<InvoiceStatus, string> = { PAID: "PAID", PARTIALLY_PAID: "PARTIALLY PAID", UNPAID: "UNPAID", CANCELLED: "CANCELLED" };

export const INVOICE_STATUS_LABEL = LABEL;

/** One tag, as in the prototype: an invoice past its due date with a balance reads OVERDUE. */
export function InvoiceStatusBadge({ status, overdueDays = 0 }: { status: InvoiceStatus; overdueDays?: number }) {
  return <Tag label={overdueDays > 0 && status !== "CANCELLED" && status !== "PAID" ? "OVERDUE" : TAG[status]} />;
}
