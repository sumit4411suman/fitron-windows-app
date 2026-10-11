"use client";

import { useActionState, useState, useTransition } from "react";
import { Badge, Button, Field, Input, Notice, Select, ScrollRegion } from "@/components/ui";
import { useConfirm } from "@/components/confirm-dialog";
import { autoMap, countOf, IMPORTS, MAX_ROWS, parseCsv, type CheckedRow, type ImportKind } from "@/lib/domain/import";
import { commitAction, openingAction, previewAction, sourceAction } from "./actions";

type Loaded = { fileName: string; headers: string[]; rows: string[][] };

/** Rows per server call: small enough that each call finishes quickly and the progress bar moves. */
const PART = 20;


/** Upload a CSV, fix the column mapping, check the rows on the server, then import the valid ones. */
export function ImportWizard({ kind }: { kind: ImportKind }) {
  const spec = IMPORTS[kind];
  const [file, setFile] = useState<Loaded | null>(null);
  const [map, setMap] = useState<Record<string, number>>({});
  const [checked, setChecked] = useState<CheckedRow[] | null>(null);
  const [error, setError] = useState("");
  const [done, setDone] = useState<string>("");
  const [consentOnPaper, setConsentOnPaper] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [pending, start] = useTransition();
  const [ask, dialog] = useConfirm();

  const load = (f: File) => {
    setError("");
    setChecked(null);
    setDone("");
    if (f.size > 4 * 1024 * 1024) return setError("That file is over 4 MB. Split it into smaller files.");
    if (/\.xlsx?$/i.test(f.name)) return setError("That's an Excel file. In Excel, use File › Save As › CSV, then upload the CSV.");
    const r = new FileReader();
    r.onload = () => {
      const all = parseCsv(String(r.result));
      if (all.length < 2) return setError("The file needs a header row and at least one data row.");
      if (all.length - 1 > MAX_ROWS) return setError(`That's ${all.length - 1} rows. Split the file into parts of ${MAX_ROWS} or fewer.`);
      const headers = all[0]!.map((h) => h.trim());
      setFile({ fileName: f.name, headers, rows: all.slice(1) });
      setMap(autoMap(kind, headers));
    };
    r.readAsText(f);
  };

  const payload = () => ({ kind, fileName: file!.fileName, rows: file!.rows, map, consentOnPaper });
  const check = () =>
    start(async () => {
      setError("");
      const r = await previewAction(payload());
      if (!r.ok) setError(r.message);
      else setChecked(r.rows);
    });
  // Only the rows that passed the check go to the server, in parts of PART rows, one call after another, so the
  // page shows "Imported 40 of 120" and a long file never sits in one request (bug 13).
  const commit = () =>
    start(async () => {
      setError("");
      const okRows = (checked ?? []).filter((r) => r.errors.length === 0).map((r) => file!.rows[r.n - 2]!);
      const total = okRows.length;
      const of = Math.max(1, Math.ceil(total / PART));
      let made = 0;
      let skipped = (file?.rows.length ?? 0) - total;
      let plansCreated = 0;
      const plansInactive: string[] = [];
      setProgress({ done: 0, total });
      for (let i = 0; i < of; i++) {
        const rows = okRows.slice(i * PART, (i + 1) * PART);
        const r = await commitAction({ kind, fileName: file!.fileName, rows, map, consentOnPaper }, { index: i + 1, of, fileRows: file!.rows.length });
        if (!r.ok) {
          setProgress(null);
          return setError(`${r.message}${made ? ` ${made} row${made === 1 ? " was" : "s were"} imported before that; check the rows and import the file again, imported rows are skipped.` : ""}`);
        }
        made += r.made;
        skipped += r.skipped;
        plansCreated += r.plansCreated;
        plansInactive.push(...r.plansInactive);
        setProgress({ done: Math.min(total, (i + 1) * PART), total });
      }
      setProgress(null);
      setDone(
        `Imported ${countOf(kind, made)}${skipped ? `; ${skipped} row${skipped === 1 ? "" : "s"} skipped` : ""}${plansCreated ? `; ${plansCreated} plan${plansCreated === 1 ? "" : "s"} created inactive (${plansInactive.join(", ")}) — set the price and activate in Plans before selling` : ""}.`,
      );
      setFile(null);
      setChecked(null);
    });

  const valid = checked?.filter((r) => r.errors.length === 0).length ?? 0;
  const fields = spec.fields;
  const cols = fields.filter(([k]) => map[k]! >= 0).map(([k, label]) => [k, label] as const);

  return (
    <div className="flex flex-col gap-4">
      {dialog}
      {done && <Notice tone="ok">{done}</Notice>}
      {error && <Notice tone="alert">{error}</Notice>}
      {progress && (
        <div role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done} aria-label="Import progress" className="flex flex-col gap-1.5">
          <div className="text-sm">
            Imported {progress.done} of {progress.total}…
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-neutral-200">
            <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%` }} />
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <Field label="CSV file">
          <Input
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) load(f);
              e.target.value = "";
            }}
          />
        </Field>
        <a href={`data:text/csv;charset=utf-8,${encodeURIComponent(spec.sample)}`} download={`fitron-${kind}-template.csv`} className="pb-2 text-sm text-accent">
          Download a template
        </a>
      </div>

      {file && (
        <>
          <p className="text-sm">
            <strong>{file.fileName}</strong> · {file.rows.length} row{file.rows.length === 1 ? "" : "s"}. Check which column holds each field.
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {fields.map(([k, label, req]) => (
              <Field key={k} label={`${label}${req ? " *" : ""}`}>
                <Select
                  value={String(map[k] ?? -1)}
                  onChange={(e) => {
                    setMap({ ...map, [k]: Number(e.target.value) });
                    setChecked(null);
                  }}
                >
                  <option value="-1">Not in the file</option>
                  {file.headers.map((h, i) => (
                    <option key={i} value={i}>
                      {h || `Column ${i + 1}`}
                    </option>
                  ))}
                </Select>
              </Field>
            ))}
          </div>
          {kind === "members" && (
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" checked={consentOnPaper} onChange={(e) => setConsentOnPaper(e.target.checked)} className="mt-0.5 size-4" />
              <span>
                These members gave consent on paper when they joined.
                <span className="block text-xs text-muted">Records today as their privacy-consent date. A &ldquo;Privacy consent&rdquo; column in the file (yes, or a date) wins for its row; without either, consent stays unrecorded and shows on the member.</span>
              </span>
            </label>
          )}
          <div className="flex flex-wrap gap-2">
            <Button onClick={check} disabled={pending} variant={checked ? "default" : "primary"}>
              {pending && !checked ? "Checking…" : "Check rows"}
            </Button>
            {checked && (
              <Button
                variant="primary"
                disabled={pending || valid === 0}
                onClick={async () => {
                  const bad = checked.length - valid;
                  if (await ask({ title: `Import ${countOf(kind, valid)}?`, message: bad ? `${bad} row${bad === 1 ? " has" : "s have"} problems and will be skipped.` : undefined, label: "Import" })) commit();
                }}
              >
                {pending ? "Importing…" : `Import ${valid} row${valid === 1 ? "" : "s"}`}
              </Button>
            )}
          </div>
        </>
      )}

      {checked && (
        <>
          <p className="text-sm">
            <Badge tone="ok">{valid} ready</Badge> <Badge tone={checked.length - valid ? "alert" : "neutral"}>{checked.length - valid} with problems</Badge>{" "}
            <span className="text-muted">Showing the first 200 rows.</span>
          </p>
          <ScrollRegion label="Import table" className="rounded-xl border border-line">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="text-left text-muted">
                <tr className="border-b border-line">
                  <th className="px-3 py-2 font-medium">Row</th>
                  {cols.slice(0, 6).map(([k, label]) => (
                    <th key={k} className="px-3 py-2 font-medium">
                      {label}
                    </th>
                  ))}
                  <th className="px-3 py-2 font-medium">Result</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {checked.slice(0, 200).map((r) => (
                  <tr key={r.n} className={r.errors.length ? "bg-alert/5" : ""}>
                    <td className="px-3 py-1.5 text-muted">{r.n}</td>
                    {cols.slice(0, 6).map(([k]) => (
                      <td key={k} className="max-w-48 truncate px-3 py-1.5">
                        {r.raw[k] || "—"}
                      </td>
                    ))}
                    <td className="px-3 py-1.5">
                      {r.errors.length ? <span className="text-alert">{r.errors.join("; ")}</span> : r.warnings.length ? <span className="text-muted">{r.warnings.join("; ")}</span> : <span className="text-ok">Ready</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>
        </>
      )}
    </div>
  );
}

export function SourceForm({ source }: { source: string }) {
  const [state, action, pending] = useActionState(sourceAction, undefined);
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <Field label="Moving from" hint="Noted on every imported record.">
        <Input name="source" defaultValue={source} placeholder="e.g. Gym Manager Pro, Excel sheets" />
      </Field>
      <Button disabled={pending}>Save</Button>
      {state?.message && <span className="pb-2 text-sm text-ok">{state.message}</span>}
    </form>
  );
}

export function OpeningForm({ v, today }: { v: { cash?: number; bank?: number; asOf?: string }; today: string }) {
  const [state, action, pending] = useActionState(openingAction, undefined);
  const e = state?.errors ?? {};
  return (
    <form action={action} key={state?.nonce} className="flex flex-col gap-3">
      {state?.message && <Notice tone={state.ok ? "ok" : "alert"}>{state.message}</Notice>}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Cash in hand (₹)" error={e.cash}>
          <Input name="cash" inputMode="decimal" defaultValue={v.cash != null ? String(v.cash / 100) : ""} />
        </Field>
        <Field label="Bank balance (₹)" error={e.bank}>
          <Input name="bank" inputMode="decimal" defaultValue={v.bank != null ? String(v.bank / 100) : ""} />
        </Field>
        <Field label="As on" error={e.asOf}>
          <Input name="asOf" type="date" max={today} defaultValue={v.asOf ?? today} required />
        </Field>
      </div>
      <div>
        <Button variant="primary" disabled={pending}>
          Save opening balances
        </Button>
      </div>
    </form>
  );
}
