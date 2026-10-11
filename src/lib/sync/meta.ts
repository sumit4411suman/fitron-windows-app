// Cloud sync: the field types of the synced tables, read from prisma/schema.prisma (scripts/sync-schema.ts writes them
// into model.generated.ts). The codec uses them to move a row between PostgreSQL, the wire and SQLite.

export type FieldType = "String" | "Int" | "BigInt" | "Boolean" | "DateTime" | "Decimal" | "Json" | "Bytes" | "Float";
export type FieldMeta = { t: FieldType; opt?: true; list?: true; date?: true };
export type ModelMeta = { pk: string[]; fields: Record<string, FieldMeta> };

const SCALARS = new Set<string>(["String", "Int", "BigInt", "Boolean", "DateTime", "Decimal", "Json", "Bytes", "Float"]);

/** Every model's scalar fields and key, read from the schema text (relation fields are skipped). */
export function parseSchema(text: string): Record<string, ModelMeta> {
  const out: Record<string, ModelMeta> = {};
  let current: ModelMeta | null = null;
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\/\/.*$/, "").trim();
    const start = /^model\s+(\w+)\s*\{/.exec(line);
    if (start) {
      current = { pk: [], fields: {} };
      out[start[1]!] = current;
      continue;
    }
    if (!current) continue;
    if (line === "}") {
      current = null;
      continue;
    }
    const compositeId = /^@@id\(\[([^\]]+)\]/.exec(line);
    if (compositeId) {
      current.pk = compositeId[1]!.split(",").map((s) => s.trim());
      continue;
    }
    const f = /^(\w+)\s+(\w+)(\[\])?(\?)?(.*)$/.exec(line);
    if (!f || !SCALARS.has(f[2]!)) continue;
    const meta: FieldMeta = { t: f[2] as FieldType };
    if (f[4]) meta.opt = true;
    if (f[3]) meta.list = true;
    if (/@db\.Date\b/.test(f[5]!)) meta.date = true;
    current.fields[f[1]!] = meta;
    if (/@id\b/.test(f[5]!)) current.pk = [f[1]!];
  }
  return out;
}
