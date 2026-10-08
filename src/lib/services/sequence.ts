import type { Prisma } from "@/generated/prisma/client";

/**
 * Gap-free numbering per organisation. Runs inside the caller's transaction, so
 * a rolled-back write doesn't burn a number and two writers can't get the same one.
 */
export async function nextNumber(tx: Prisma.TransactionClient, orgId: string, name: string, start = 1001): Promise<number> {
  const rows = await tx.$queryRaw<{ next: number }[]>`
    INSERT INTO "Sequence" ("orgId", "name", "next") VALUES (${orgId}, ${name}, ${start + 1})
    ON CONFLICT ("orgId", "name") DO UPDATE SET "next" = "Sequence"."next" + 1
    RETURNING "next" - 1 AS "next"`;
  return Number(rows[0].next);
}

export const SEQ_PREFIX = {
  member: "FT-",
  membership: "MS-",
  invoice: "INV-",
  payment: "PAY-",
  expense: "EXP-",
} as const;
