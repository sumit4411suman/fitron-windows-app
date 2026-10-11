import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { isLocal } from "@/lib/runtime/edition";

// The database refuses to delete financial records (prisma/migrations/20261005031500_financial_row_guard on PostgreSQL,
// prisma/local-migrations/0001_init on SQLite), except inside a transaction that says why. Two operations do, because
// removing money rows is their job; nothing else should call this.
//  - "demo-clear": Go live > Clear demo data. The database also checks that the rows belong to a gym flagged demo.
//  - "restore": Settings > Backup > Restore from file, after it has made a safety copy of what is there.
// PostgreSQL: a transaction-local setting that ends with the transaction. SQLite: a row in _fitron_guard written inside
// the transaction; a rollback removes it, and `revokeDelete` must be called before the commit so it does not outlive it
// (the adapter also clears the table whenever it connects, so a leftover row never survives a restart).
export type DeleteReason = "demo-clear" | "restore";

export async function allowDelete(tx: Prisma.TransactionClient, why: DeleteReason) {
  if (isLocal()) {
    await tx.$executeRaw`INSERT OR REPLACE INTO "_fitron_guard" ("id", "allowDelete") VALUES (1, ${why})`;
    return;
  }
  await tx.$executeRaw`SELECT set_config('fitron.allow_delete', ${why}, true)`;
}

/** Ends the permission before the transaction commits. A no-op on PostgreSQL, where it ends by itself. */
export async function revokeDelete(tx: Prisma.TransactionClient) {
  if (!isLocal()) return;
  await tx.$executeRaw`DELETE FROM "_fitron_guard"`;
}
