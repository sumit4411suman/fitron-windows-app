import { PrismaClient as LocalPrismaClient } from "@/generated/prisma-local/client";
import type { PrismaClient } from "@/generated/prisma/client";
import { sqliteAdapter } from "./sqlite-adapter";
import { inSlices, NOT_SLICED } from "./sqlite-in";

// The Local Edition's Prisma client, shaped like the Cloud one.
//
// SQLite has no array columns, so the four string-list fields of the Cloud schema (Member.tags, Member.riskReasons,
// MembershipPlan.features, AiProposal.memberIds) are JSON text in prisma/schema.local.prisma. Services are written
// against the Cloud types and pass and expect arrays; this extension turns arrays into JSON on the way in (create,
// update, upsert, createMany, nested writes) and JSON back into arrays on the way out (every read, including rows
// reached through include/select), so no service needs to know. Filters on these fields are not used by the
// application (src/lib/db-dialect.ts has listHas/listEmpty should one be needed).
export const LIST_FIELDS = new Set(["tags", "riskReasons", "features", "memberIds"]);

/** Only object literals are walked. Prisma's own objects (field references, Decimal, Date, bytes) pass through as they are. */
const isPlain = (v: unknown): v is Record<string, unknown> => {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
};

/** Arrays under a list key become JSON text. Walks nested writes; leaves `select`/`include` (booleans) and filters (objects) alone. */
export function encodeLists<T>(value: T): T {
  if (Array.isArray(value)) return value.map(encodeLists) as unknown as T;
  if (!isPlain(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = LIST_FIELDS.has(k) && Array.isArray(v) && v.every((x) => typeof x === "string") ? JSON.stringify(v) : encodeLists(v);
  }
  return out as T;
}

/** JSON text under a list key becomes an array again, anywhere in the result tree. */
export function decodeLists<T>(value: T): T {
  if (Array.isArray(value)) return value.map(decodeLists) as unknown as T;
  if (!isPlain(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (LIST_FIELDS.has(k) && typeof v === "string" && v.startsWith("[")) {
      try {
        const parsed: unknown = JSON.parse(v);
        out[k] = Array.isArray(parsed) ? parsed : v;
        continue;
      } catch {
        // Not JSON after all: leave the text as it is.
      }
    }
    out[k] = decodeLists(v);
  }
  return out as T;
}

const LIST_MODELS = new Set(["Member", "MembershipPlan", "AiProposal"]);

/**
 * A guard trigger (prisma/local-migrations/0001_init) aborts with its own sentence: "Deleting a Payment record is not
 * allowed…". Prisma reports SQLITE_CONSTRAINT_TRIGGER as a foreign-key error (P2003) and keeps the sentence only deep in
 * `meta`. Bring it back as the error's message, as PostgreSQL's RAISE EXCEPTION does, so the person sees why.
 */
export function triggerError(e: unknown): Error | null {
  const cause = (e as { meta?: { driverAdapterError?: { cause?: { originalCode?: string; originalMessage?: string } } } })?.meta?.driverAdapterError?.cause;
  if (cause?.originalCode !== "SQLITE_CONSTRAINT_TRIGGER" || !cause.originalMessage) return null;
  const err = new Error(cause.originalMessage);
  err.name = "FinancialRecordGuard";
  (err as Error & { code?: string }).code = "FITRON_GUARD";
  return err;
}

const isUnique = (e: unknown) => !!e && typeof e === "object" && (e as { code?: string }).code === "P2002";

/**
 * createMany({ skipDuplicates: true }) is PostgreSQL's ON CONFLICT DO NOTHING, which Prisma does not offer on SQLite.
 * The rows are inserted together first; only when one clashes are they inserted one by one, skipping the clashes.
 */
async function createManySkippingDuplicates(args: Record<string, unknown>, query: (args: unknown) => Promise<unknown>) {
  const rest = { ...args };
  delete rest.skipDuplicates;
  const data = Array.isArray(rest.data) ? rest.data : [rest.data];
  try {
    return await query({ ...rest, data });
  } catch (e) {
    if (!isUnique(e)) throw e;
  }
  let count = 0;
  for (const row of data) {
    try {
      await query({ ...rest, data: [row] });
      count += 1;
    } catch (e) {
      if (!isUnique(e)) throw e;
    }
  }
  return { count };
}
const WRITE_OPS = new Set(["create", "update", "upsert", "createMany", "createManyAndReturn", "updateMany", "updateManyAndReturn"]);

export function makeLocalClient(url: string): PrismaClient {
  const base = new LocalPrismaClient({ adapter: sqliteAdapter({ url }) });
  // The generated $extends signature is too wide for the compiler to resolve here; the extension below only reshapes
  // arguments and results, so the client's own types are unaffected.
  type Op = { model?: string; operation: string; args: unknown; query: (args: unknown) => Promise<unknown> };
  const extend = (base as unknown as { $extends: (ext: { query: { $allOperations: (op: Op) => Promise<unknown> } }) => unknown }).$extends;
  const client = extend.call(base, {
    query: {
      // Top level, so raw queries ($executeRaw) are covered too; `model` is undefined for those.
      async $allOperations({ model, operation, args, query }: Op) {
        try {
          // Writes: only the three models hold list fields, but a nested write can reach them from any model
          // (a lead converted into a member, a plan created with its prices), so encode every write's args.
          const a = WRITE_OPS.has(operation) || (model && LIST_MODELS.has(model)) ? encodeLists(args) : args;
          if (operation === "createMany" && isPlain(a) && a.skipDuplicates) return decodeLists(await createManySkippingDuplicates(a, query));
          // A list longer than SQLite takes in one statement is read in slices (sqlite-in.ts).
          const sliced = await inSlices(operation, a, query);
          return decodeLists(sliced === NOT_SLICED ? await query(a) : sliced);
        } catch (e) {
          throw triggerError(e) ?? e;
        }
      },
    },
  });
  return client as unknown as PrismaClient;
}
