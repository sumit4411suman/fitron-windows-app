import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { poolConfig } from "../src/lib/db-config";

export const makeClient = () => new PrismaClient({ adapter: new PrismaPg(poolConfig()) });
