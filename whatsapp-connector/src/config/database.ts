import { PrismaClient } from "../generated/prisma/index.js";
import { env } from "./env.js";

// One Prisma client per process. Query logging is off: messages and phone numbers must not land in logs.
let client: PrismaClient | null = null;

export function prisma(): PrismaClient {
  if (!client) {
    client = new PrismaClient({
      datasources: { db: { url: env().DATABASE_URL } },
      log: env().NODE_ENV === "development" ? ["warn", "error"] : ["error"],
    });
  }
  return client;
}

/** Lets tests swap in a client of their own. */
export function setPrisma(c: PrismaClient | null): void {
  client = c;
}

export async function disconnectPrisma(): Promise<void> {
  if (client) {
    await client.$disconnect();
    client = null;
  }
}
