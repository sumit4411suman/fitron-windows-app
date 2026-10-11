import { INVOICE_STATUS_LABEL, INVOICE_STATUS_TAG, type InvoiceStatus } from "@/lib/domain/billing";
import { Tag } from "./tag";

export { INVOICE_STATUS_LABEL, INVOICE_STATUS_TAG };

/** One tag, as in the prototype: an invoice past its due date with a balance reads OVERDUE. */
export function InvoiceStatusBadge({ status, overdueDays = 0 }: { status: InvoiceStatus; overdueDays?: number }) {
  return <Tag label={overdueDays > 0 && status !== "CANCELLED" && status !== "PAID" ? "OVERDUE" : INVOICE_STATUS_TAG[status]} />;
}
