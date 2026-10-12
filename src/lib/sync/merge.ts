import { changedFields, type WireRow } from "./codec";
import { SYNC_ENTITY } from "./entities";

// Cloud sync: what happens to a computer's change when the website changed the same record since the computer last
// saw it (SYNC.md §6). Pure: the server reads the three versions and applies the decision.

export type ConflictNote = {
  /** merged: applied, both changed the same fields (the computer's, confirmed later, stands); kept-website: the website's
   *  record stands and the computer's change is set aside; deleted: a delete met an edit (the delete stands). */
  kind: "merged" | "kept-website" | "deleted";
  fields: string[];
  /** The computer's version */
  ours: WireRow | null;
  /** The website's version */
  theirs: WireRow | null;
};

export type Decision = { action: "apply"; data: WireRow | null; conflict?: ConflictNote } | { action: "keep"; conflict?: ConflictNote };

export type DecideInput = {
  entity: string;
  /** The record as the computer last received it (null when that version is not known, or it did not exist). */
  base: WireRow | null;
  baseKnown: boolean;
  /** The record on the website now (null: not there, or deleted). */
  current: WireRow | null;
  /** The computer's record (null: the computer deleted it). */
  incoming: WireRow | null;
  /** Someone other than this computer changed the record after the version the computer started from. */
  contested: boolean;
};

/** Kept by the database itself on every write; never a disagreement between the two sides. */
const BOOKKEEPING = new Set(["updatedAt"]);

const later = (a: unknown, b: unknown) => (typeof a === "string" && typeof b === "string" ? (a > b ? a : b) : (a ?? b));

export function decide(i: DecideInput): Decision {
  if (!i.contested) return { action: "apply", data: i.incoming };
  const spec = SYNC_ENTITY.get(i.entity);
  const all = (a: WireRow | null, b: WireRow | null) => changedFields(i.entity, a, b).filter((f) => !BOOKKEEPING.has(f));
  // A delete wins over a concurrent edit; the edit is kept so nothing is lost silently.
  if (!i.current) return i.incoming ? { action: "keep", conflict: { kind: "deleted", fields: [], ours: i.incoming, theirs: null } } : { action: "apply", data: null };
  if (!i.incoming) return { action: "apply", data: null, conflict: { kind: "deleted", fields: [], ours: null, theirs: i.current } };
  switch (spec?.kind) {
    case "lww":
      return { action: "apply", data: i.incoming };
    case "merge": {
      const local = i.baseKnown ? all(i.base, i.incoming) : all(i.current, i.incoming);
      const remote = i.baseKnown ? all(i.base, i.current) : local;
      const merged: WireRow = { ...i.current };
      for (const f of local) merged[f] = i.incoming[f];
      for (const f of BOOKKEEPING) if (f in i.current || f in i.incoming) merged[f] = later(i.current[f], i.incoming[f]);
      const both = local.filter((f) => remote.includes(f));
      return both.length ? { action: "apply", data: merged, conflict: { kind: "merged", fields: both, ours: i.incoming, theirs: i.current } } : { action: "apply", data: merged };
    }
    default:
    {
      // Money and memberships: the website's record stands. When the two agree on everything but the timestamp, nothing
      // is set aside, because nothing differs.
      const fields = all(i.current, i.incoming);
      return fields.length ? { action: "keep", conflict: { kind: "kept-website", fields, ours: i.incoming, theirs: i.current } } : { action: "keep" };
    }
  }
}
