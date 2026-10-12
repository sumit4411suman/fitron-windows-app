import { orgSql, SYNC_ENTITIES, type SyncEntity } from "./entities";

// The SQL of the change-capture triggers, for both databases, made from the entity table (entities.ts). The output is
// pasted into a migration by scripts/sync-schema.ts; sync-schema.test.ts checks every synced table has its triggers.
//
// PostgreSQL (fitron.in): every insert, update and delete of a synced row adds a SyncChange row with the row's data as it
// now is (minus the fields that never sync), in the same transaction. `fitron.sync_origin` names who made the change
// (a linked computer when the server applies one of its changes; "cloud" otherwise). Nothing is recorded while a
// restore or "Clear demo data" holds the financial-row guard's permission: those replace a gym's rows wholesale, and
// every linked computer is told to download the gym again instead (src/lib/sync/server.ts, requireResync).
//
// SQLite (the computer): only that a row changed (table, key, insert/update/delete); the client reads the row as it is
// when it uploads, so several changes to one record go up as one. Nothing is recorded until the computer is linked,
// while the client itself applies changes that came from fitron.in (_fitron_sync_apply), or during a guarded delete.

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** The record's key as one string: its id, or composite keys joined by "|" (ids never contain one). */
export function keyExpr(pk: string[], alias: string): string {
  return pk.map((k) => `${alias}."${k}"`).join(" || '|' || ");
}

const orgExpr = orgSql;

export function pgTrigger(e: SyncEntity, pk: string[]): string {
  const minus = (e.omit ?? []).map((f) => ` - ${q(f)}`).join("");
  const skipKeys = e.skipKeys?.length ? `\n  IF r."key" IN (${e.skipKeys.map(q).join(", ")}) THEN RETURN NULL; END IF;` : "";
  return `CREATE FUNCTION "fitron_sync_${e.name}"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  r record;
  org text;
BEGIN
  IF COALESCE(current_setting('fitron.allow_delete', true), '') <> '' THEN RETURN NULL; END IF;
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;${skipKeys}
  IF TG_OP = 'UPDATE' AND (to_jsonb(NEW)${minus}) = (to_jsonb(OLD)${minus}) THEN RETURN NULL; END IF;
  org := ${orgExpr(e, "r")};
  IF org IS NULL THEN RETURN NULL; END IF;
  INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "data", "origin", "status", "attempts", "createdAt")
  VALUES (gen_random_uuid()::text, org, ${q(e.name)}, ${keyExpr(pk, "r")}, CASE WHEN TG_OP = 'DELETE' THEN 'delete' ELSE 'upsert' END,
          CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW)${minus} END,
          COALESCE(NULLIF(current_setting('fitron.sync_origin', true), ''), 'cloud'), 'DONE', 0, now());
  RETURN NULL;
END
$$;
CREATE TRIGGER "fitron_sync" AFTER INSERT OR UPDATE OR DELETE ON "${e.name}" FOR EACH ROW EXECUTE FUNCTION "fitron_sync_${e.name}"();`;
}


/** Columns whose change is worth an upload on SQLite (User only: sign-ins touch lastLoginAt all the time). */
export function sqliteTriggers(e: SyncEntity, pk: string[], columns: string[]): string {
  const when = (alias: string) =>
    [`(SELECT "linked" FROM "SyncState" WHERE "id" = 1) = 1`, `NOT EXISTS (SELECT 1 FROM "_fitron_sync_apply")`, `NOT EXISTS (SELECT 1 FROM "_fitron_guard")`]
      .concat(e.skipKeys?.length ? [`${alias}."key" NOT IN (${e.skipKeys.map(q).join(", ")})`] : [])
      .join("\n  AND ");
  const changed = e.omit?.length
    ? `\n  AND (${columns
        .filter((c) => !e.omit!.includes(c))
        .map((c) => `OLD."${c}" IS NOT NEW."${c}"`)
        .join(" OR ")})`
    : "";
  const insert = (alias: string, op: string) =>
    `INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "origin", "status", "attempts", "createdAt")
  VALUES (lower(hex(randomblob(16))), COALESCE(${orgExpr(e, alias)}, ''), ${q(e.name)}, ${keyExpr(pk, alias)}, ${q(op)}, 'local', 'PENDING', 0, strftime('%Y-%m-%dT%H:%M:%f', 'now') || '+00:00');`;
  return [
    `CREATE TRIGGER "fitron_sync_${e.name}_insert" AFTER INSERT ON "${e.name}" FOR EACH ROW
WHEN ${when("NEW")}
BEGIN ${insert("NEW", "upsert")} END;`,
    `CREATE TRIGGER "fitron_sync_${e.name}_update" AFTER UPDATE ON "${e.name}" FOR EACH ROW
WHEN ${when("NEW")}${changed}
BEGIN ${insert("NEW", "upsert")} END;`,
    `CREATE TRIGGER "fitron_sync_${e.name}_delete" AFTER DELETE ON "${e.name}" FOR EACH ROW
WHEN ${when("OLD")}
BEGIN ${insert("OLD", "delete")} END;`,
  ].join("\n\n");
}

export const triggerNames = (dialect: "pg" | "sqlite") =>
  SYNC_ENTITIES.flatMap((e) => (dialect === "pg" ? [`fitron_sync_${e.name}`] : ["insert", "update", "delete"].map((op) => `fitron_sync_${e.name}_${op}`)));
