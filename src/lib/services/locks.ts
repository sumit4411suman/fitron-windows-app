import type { Prisma } from "@/generated/prisma/client";
import type { CurrentUser } from "@/lib/auth/current";
import { UserError } from "./errors";

/**
 * Rule 7: writes dated in a locked month are refused unless the user may unlock months.
 * `date` is YYYY-MM-DD.
 */
export async function assertMonthOpen(tx: Prisma.TransactionClient, u: CurrentUser, branchId: string, date: string) {
  if (u.can("months.unlock")) return;
  const month = date.slice(0, 7);
  const lock = await tx.monthLock.findUnique({ where: { branchId_month: { branchId, month } } });
  if (lock) throw new UserError(`${month} is locked for this branch. Ask a Super Admin to unlock it.`, "date");
}
