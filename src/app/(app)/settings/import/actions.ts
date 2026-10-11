"use server";

import { revalidatePath } from "next/cache";
import * as z from "zod";
import "@/lib/zod-config";
import { requirePermission } from "@/lib/auth/current";
import { formAction } from "@/lib/form-action";
import { IMPORT_KINDS, type CheckedRow } from "@/lib/domain/import";
import { rupees, type FormState } from "@/lib/validation/common";
import { commitImport, previewImport, setMigrationSource, setOpening } from "@/lib/services/importer";
import { UserError } from "@/lib/services/errors";

const payload = z.object({
  kind: z.enum(IMPORT_KINDS),
  fileName: z.string().max(200),
  rows: z.array(z.array(z.string().max(2000)).max(100)).max(5000),
  map: z.record(z.string(), z.number().int().min(-1).max(99)),
  /** Members only: they gave consent on paper when they joined, so every row without its own consent value gets today's date. */
  consentOnPaper: z.boolean().optional(),
});
type Payload = z.infer<typeof payload>;

const partSchema = z.object({ index: z.number().int().min(1), of: z.number().int().min(1), fileRows: z.number().int().min(0).max(5000).optional() });

export type PreviewResult = { ok: true; rows: CheckedRow[] } | { ok: false; message: string };
export type CommitResult = { ok: true; made: number; skipped: number; plansCreated: number; plansInactive: string[] } | { ok: false; message: string };

export async function previewAction(input: Payload): Promise<PreviewResult> {
  const u = await requirePermission("import.run");
  const p = payload.safeParse(input);
  if (!p.success) return { ok: false, message: "The file couldn't be read. Check it is a CSV with at most 5,000 rows." };
  try {
    return { ok: true, rows: await previewImport(u, p.data.kind, p.data.rows, p.data.map) };
  } catch (e) {
    if (e instanceof UserError) return { ok: false, message: e.message };
    throw e;
  }
}

/**
 * Imports the rows sent, which the import page sends in parts (`part` = index of total) so it can show progress
 * and no single request runs long. Pages are revalidated once, after the last part.
 */
export async function commitAction(input: Payload, part?: { index: number; of: number; fileRows?: number }): Promise<CommitResult> {
  const u = await requirePermission("import.run");
  const p = payload.safeParse(input);
  const pt = part === undefined ? undefined : partSchema.safeParse(part);
  if (!p.success || (pt && !pt.success)) return { ok: false, message: "The file couldn't be read." };
  try {
    const r = await commitImport(u, p.data.kind, p.data.rows, p.data.map, p.data.fileName, pt?.data, { consentOnPaper: p.data.kind === "members" && !!p.data.consentOnPaper });
    if (!pt || pt.data.index >= pt.data.of) revalidatePath("/", "layout");
    return { ok: true, ...r };
  } catch (e) {
    if (e instanceof UserError) return { ok: false, message: e.message };
    throw e;
  }
}

export async function sourceAction(_: FormState, fd: FormData): Promise<FormState> {
  const u = await requirePermission("import.run");
  const r = await formAction(fd, z.object({ source: z.string().trim().max(80) }), (d) => setMigrationSource(u, d.source), "Saved.");
  revalidatePath("/settings/import");
  return r;
}

const opening = z.object({
  cash: z.preprocess((v) => (v === "" ? "0" : v), rupees),
  bank: z.preprocess((v) => (v === "" ? "0" : v), rupees),
  asOf: z.iso.date({ error: "Pick the date." }),
});

export async function openingAction(_: FormState, fd: FormData): Promise<FormState> {
  const u = await requirePermission("import.run");
  const r = await formAction(fd, opening, (d) => setOpening(u, d), "Opening balances saved.");
  revalidatePath("/settings/import");
  revalidatePath("/accounting");
  return r;
}
