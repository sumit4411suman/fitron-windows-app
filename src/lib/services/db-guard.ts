import "server-only";
import type { Prisma } from "@/generated/prisma/client";

// The database refuses to delete financial records (prisma/migrations/20261005031500_financial_row_guard), except inside a
// transaction that says why. Two operations do, because removing money rows is their job; nothing else should call this.
//  - "demo-clear": Go live > Clear demo data. The database also checks that the rows belong to a gym flagged demo.
//  - "restore": Settings > Backup > Restore from file, after it has made a safety copy of what is there.
// The permission lasts until the end of the transaction it is given in.
export type DeleteReason = "demo-clear" | "restore";

export async function allowDelete(tx: Prisma.TransactionClient, why: DeleteReason) {
  await tx.$executeRaw`SELECT set_config('fitron.allow_delete', ${why}, true)`;
}
