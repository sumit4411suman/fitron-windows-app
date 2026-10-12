import type { Prisma } from "@/generated/prisma/client";
import { isLocal } from "@/lib/runtime/edition";

/**
 * Each computer linked to fitron.in numbers from a range of its own, so it and the website (and other computers) never
 * issue the same invoice, payment or member number while apart: computer N uses N × 1,000,000 upward (its first invoice
 * is INV-1001001), the website keeps its own counter. A separate series per place of issue, each consecutive.
 */
export const DEVICE_RANGE = 1_000_000;

export async function numberFloor(tx: Prisma.TransactionClient): Promise<number> {
  if (!isLocal()) return 0;
  const s = await tx.syncState.findUnique({ where: { id: 1 }, select: { linked: true, deviceNo: true } });
  return s?.linked && s.deviceNo > 0 ? s.deviceNo * DEVICE_RANGE : 0;
}

/**
 * Gap-free numbering per organisation. Runs inside the caller's transaction, so
 * a rolled-back write doesn't burn a number and two writers can't get the same one.
 */
export async function nextNumber(tx: Prisma.TransactionClient, orgId: string, name: string, start = 1001): Promise<number> {
  const floor = await numberFloor(tx);
  if (floor) {
    // A counter from before this computer was linked moves into its range the first time it is used.
    await tx.$executeRaw`UPDATE "Sequence" SET "next" = "next" + ${floor} WHERE "orgId" = ${orgId} AND "name" = ${name} AND "next" <= ${floor}`;
    start += floor;
  }
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
