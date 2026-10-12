import type { WireRow } from "./codec";
import type { ConflictNote } from "./merge";

// Cloud sync: what goes over the wire between FITRON for Windows and fitron.in (docs/local-windows/SYNC.md §2).
// Every request from a computer carries its device token (Authorization: Bearer fsd_…); the server finds the gym from
// the token, never from the request.

/** Protocol version: a computer and a server that disagree refuse each other with a clear message. */
export const SYNC_PROTOCOL = 1;

/** Largest batch either way. */
export const PULL_LIMIT = 500;
export const PUSH_LIMIT = 100;
export const SNAPSHOT_LIMIT = 500;

/** One change the computer uploads: the record as it is now (null when deleted), from the version it started from. */
export type PushItem = {
  /** The idempotency key: the newest of the computer's changes to this record that this upload covers */
  changeId: string;
  entity: string;
  entityId: string;
  op: "upsert" | "delete";
  data: WireRow | null;
  /** The fitron.in version of the record the computer last received (0: none) */
  baseVersion: number;
};

export type PushResult = {
  changeId: string;
  /** applied: stored (possibly merged); conflict: the website's record stands, the change is kept for the owner;
   *  rejected: refused with a reason (nothing stored) */
  status: "applied" | "conflict" | "rejected";
  /** The record's fitron.in version after this upload */
  version?: number;
  /** The record as fitron.in now has it, when that differs from what was sent (merged, or the website's record kept) */
  current?: WireRow | null;
  conflict?: ConflictNote;
  reason?: string;
  /** This change id was applied before: the stored answer is repeated, nothing was applied again */
  replayed?: boolean;
};

export type PulledChange = { seq: number; entity: string; entityId: string; op: "upsert" | "delete"; data: WireRow | null; origin: string };

export type ChangesPage = {
  changes: PulledChange[];
  /** Pull again from here */
  next: number;
  /** The gym's newest change */
  latest: number;
  more: boolean;
  /** The gym's records were replaced wholesale on fitron.in (a restore): download the whole gym again */
  resync: boolean;
};

export type SnapshotPage = { entity: string; rows: { data: WireRow; version: number }[]; last: string | null; seq: number };

export type LinkedGym = {
  token: string;
  device: { id: string; no: number; name: string };
  org: { id: string; name: string };
  user: { id: string; name: string; email: string; phone: string };
  /** The gym's newest change when the link was made */
  seq: number;
};

export type GymCheck = { org: { id: string; name: string }; counts: { members: number; invoices: number; payments: number }; devices: number };

/** An answer the server gives instead of data, with words for the owner. */
export type SyncErrorBody = { error: string; code?: "unlinked" | "protocol" | "two-step" | "locked" | "rejected" };
