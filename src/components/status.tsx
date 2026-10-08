import type { MembershipStatus } from "@/lib/domain/membership";
import { Tag } from "./tag";

export const STATUS_LABEL: Record<MembershipStatus, string> = {
  ACTIVE: "Active",
  EXPIRING_SOON: "Expiring soon",
  PAYMENT_PENDING: "Payment pending",
  EXPIRED: "Expired",
  SUSPENDED: "Suspended",
};
/** Member status as the prototype's uppercase tag ("EXPIRING SOON"). */
export const MemberStatus = ({ status, className }: { status: MembershipStatus; className?: string }) => <Tag label={STATUS_LABEL[status].toUpperCase()} className={className} />;
