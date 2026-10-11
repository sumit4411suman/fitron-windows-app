// Derives prisma/schema.local.prisma (SQLite, the Local Windows Edition) from prisma/schema.prisma (PostgreSQL, the
// Cloud Edition). The two schemas carry the same models, fields and relations so one set of services compiles against
// either generated client; only what SQLite cannot store changes, and every change is listed in
// docs/local-windows/DATABASE-MIGRATION.md. Run `npx tsx scripts/local-schema.ts`; src/lib/local-schema.test.ts fails
// when the file on disk is out of date.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = new URL("../", import.meta.url);
const CLOUD = fileURLToPath(new URL("prisma/schema.prisma", ROOT));
const LOCAL = fileURLToPath(new URL("prisma/schema.local.prisma", ROOT));

export function toLocalSchema(cloud: string): string {
  let s = cloud;
  s = s.replace(
    /^\/\/ Fitron core schema[^\n]*\n/,
    `// FITRON Local Windows Edition schema (SQLite). GENERATED from prisma/schema.prisma by scripts/local-schema.ts:
// edit the Cloud schema and run \`npx tsx scripts/local-schema.ts\`. Differences from the Cloud schema are listed in
// docs/local-windows/DATABASE-MIGRATION.md; the SQL of each migration lives in prisma/local-migrations.
//
`,
  );
  s = s.replace('output   = "../src/generated/prisma"', 'output   = "../src/generated/prisma-local"');
  s = s.replace('provider = "postgresql"', 'provider = "sqlite"');
  // Native type attributes are PostgreSQL's. SQLite's Prisma types: DateTime (ISO text), Decimal (DECIMAL), String (TEXT).
  // The Indian-date and timestamp distinction lives in the column comments and src/lib/services/time.ts, not in the type.
  s = s.replace(/ *@db\.(Timestamptz|Date|Decimal\(\d+, ?\d+\)|VarChar\(\d+\))/g, "");
  // SQLite has no arrays: a String[] becomes JSON text ("[]" by default), read and written through src/lib/db-dialect.ts.
  s = s.replace(/^(\s+\w+\s+)String\[\](\s+)@default\(\[\]\)/gm, '$1String$2@default("[]")');
  s = s.replace(/^(\s+\w+\s+)String\[\]\s*$/gm, '$1String @default("[]")');
  // Lines that only held a native type may keep trailing spaces; tidy them so the file is stable.
  s = s.replace(/[ \t]+$/gm, "");
  return s;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const out = toLocalSchema(readFileSync(CLOUD, "utf8"));
  writeFileSync(LOCAL, out);
  console.log(`wrote ${LOCAL}`);
}
