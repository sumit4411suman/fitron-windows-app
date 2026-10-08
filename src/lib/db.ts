import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { poolConfig } from "./db-config";

// One client per server process; reused across hot reloads in dev.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db = globalForPrisma.prisma ?? new PrismaClient({ adapter: new PrismaPg(poolConfig()) });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
