import type { Prisma } from "@/generated/prisma/client";
import { isLocal } from "./runtime/edition";

// The handful of places where PostgreSQL (Cloud Edition) and SQLite (Local Edition) differ. Everything else in
// src/lib/services is plain Prisma and runs on both unchanged.

type Tx = Prisma.TransactionClient;

/**
 * Serialises writers on one key for the rest of the transaction. PostgreSQL: an advisory lock, so two requests that
 * chain onto the audit log, redeem a coupon or check a member in at the same moment take turns. SQLite: one writer at a
 * time is how the database works, and the adapter runs one transaction at a time (src/lib/runtime/sqlite-adapter.ts),
 * so there is nothing to take.
 */
export async function lockKey(tx: Tx, key: string): Promise<void> {
  if (isLocal()) return;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
}

/** Locks one row until the transaction ends (SELECT … FOR UPDATE). SQLite: see lockKey. The table name is a model name, never user input. */
export async function lockRow(tx: Tx, table: "Member" | "ClassSlot" | "Purchase" | "BranchSubscription" | "TrainerPayment", id: string): Promise<void> {
  if (isLocal()) return;
  await tx.$queryRawUnsafe(`SELECT id FROM "${table}" WHERE id = $1 FOR UPDATE`, id);
}

/**
 * A case-insensitive "contains" filter. PostgreSQL needs `mode: "insensitive"`; SQLite's LIKE already ignores case for
 * ASCII letters and rejects the `mode` key. Names, codes and phone numbers in the console are ASCII, so searching
 * behaves the same on both.
 */
export function ci(text: string): { contains: string; mode?: "insensitive" } {
  return isLocal() ? { contains: text } : { contains: text, mode: "insensitive" };
}

/** A case-insensitive "equals" filter, for codes and names typed by hand. SQLite compares with LIKE here (no wildcards in a code or a plan name). */
export function ciEquals(text: string): { equals: string; mode?: "insensitive" } | { contains: string } {
  return isLocal() ? { contains: text } : { equals: text, mode: "insensitive" };
}

/** Filter "list column contains value" (Member.tags and the like). PostgreSQL: `has`; SQLite: a LIKE on the JSON text. */
export function listHas(value: string): Record<string, unknown> {
  return isLocal() ? { contains: JSON.stringify(value) } : { has: value };
}

/**
 * Filter "list column holds any of these values" (AiProposal.memberIds), spread into a `where`. PostgreSQL: `hasSome`;
 * SQLite: one LIKE per value on the JSON text. No values match nothing on both.
 */
export function listHasSome(field: string, values: string[]): Record<string, unknown> {
  if (!isLocal()) return { [field]: { hasSome: values } };
  return { OR: values.map((v) => ({ [field]: { contains: JSON.stringify(v) } })) };
}

/** Filter "list column is empty". */
export function listEmpty(): Record<string, unknown> {
  return isLocal() ? { equals: "[]" } : { isEmpty: true };
}

/**
 * A JSON path for Json-column filters (`path: …, string_contains`). PostgreSQL takes the keys as an array; SQLite takes
 * one JSONPath string ("$.invoice.number").
 */
export function jsonPath(keys: string[]): string[] {
  // Typed as the Cloud client expects; the Local client receives the string it expects.
  return (isLocal() ? `$.${keys.join(".")}` : keys) as string[];
}

/** The next number of FITRON's own tax invoices to gyms (one counter for all gyms). */
export async function nextFitronInvoiceNumber(tx: Tx): Promise<bigint> {
  if (isLocal()) {
    const [{ n }] = await tx.$queryRaw<{ n: bigint }[]>`INSERT INTO "_fitron_invoice_seq" DEFAULT VALUES RETURNING "n"`;
    return BigInt(n);
  }
  const [{ n }] = await tx.$queryRaw<{ n: bigint }[]>`SELECT nextval('fitron_invoice_seq') AS n`;
  return n;
}
