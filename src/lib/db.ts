import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { poolConfig } from "./db-config";
import { isLocal } from "./runtime/edition";
import { makeLocalClient } from "./runtime/local-client";
import { localDatabaseUrl } from "./runtime/paths";

// One client per server process; reused across hot reloads in dev.
//
// Two editions, one client type. The Cloud Edition talks to PostgreSQL (prisma/schema.prisma); the Local Windows Edition
// talks to a SQLite file (prisma/schema.local.prisma, generated from the Cloud schema by scripts/local-schema.ts, same
// models and fields). Services are written against the Cloud client's types; the Local client has the same shape
// (src/lib/runtime/local-client.ts), so it is handed out as that type. The few places where the two databases differ in
// behaviour go through src/lib/db-dialect.ts.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

const makeClient = (): PrismaClient => (isLocal() ? makeLocalClient(localDatabaseUrl()) : new PrismaClient({ adapter: new PrismaPg(poolConfig()) }));

export const db: PrismaClient = globalForPrisma.prisma ?? makeClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
