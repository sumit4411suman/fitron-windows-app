import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // Migrations need a real session. A pooler that hands out a connection per statement (Supabase's transaction pooler, port
    // 6543, which serverless hosting uses for DATABASE_URL) breaks them, so DIRECT_URL, when set, is used for them instead.
    url: process.env["DIRECT_URL"] || process.env["DATABASE_URL"],
    shadowDatabaseUrl: process.env["SHADOW_DATABASE_URL"],
  },
});
