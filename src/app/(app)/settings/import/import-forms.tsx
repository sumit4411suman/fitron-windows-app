"use client";

import { useActionState, useState, useTransition } from "react";
import { Badge, Button, Field, Input, Notice, Select, ScrollRegion } from "@/components/ui";
import { autoMap, IMPORTS, MAX_ROWS, parseCsv, type CheckedRow, type ImportKind } from "@/lib/domain/import";
import { commitAction, openingAction, previewAction, sourceAction } from "./actions";

type Loaded = { fileName: string; headers: string[]; rows: string[][] };


/** Upload a CSV, fix the column mapping, check the rows on the server, then import the valid ones. */
export function ImportWizard({ kind }: { kind: ImportKind }) {
  const spec = IMPORTS[kind];
  const [file, setFile] = useState<Loaded | null>(null);
  const [map, setMap] = useState<Record<string, number>>({});
  const [checked, setChecked] = useState<CheckedRow[] | null>(null);
  const [error, setError] = useState("");
  const [done, setDone] = useState<string>("");
  const [pending, start] = useTransition();

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

  const payload = () => ({ kind, fileName: file!.fileName, rows: file!.rows, map });
  const check = () =>
    start(async () => {
      setError("");
      const r = await previewAction(payload());
      if (!r.ok) setError(r.message);
      else setChecked(r.rows);
    });
  const commit = () =>
    start(async () => {
      const r = await commitAction(payload());
      if (!r.ok) return setError(r.message);
      setDone(`Imported ${r.made} ${spec.label.toLowerCase()}${r.skipped ? `; ${r.skipped} row${r.skipped === 1 ? "" : "s"} skipped` : ""}${r.plansCreated ? `; ${r.plansCreated} plan${r.plansCreated === 1 ? "" : "s"} created` : ""}.`);
      setFile(null);
      setChecked(null);
    });

  const valid = checked?.filter((r) => r.errors.length === 0).length ?? 0;
  const fields = spec.fields;
  const cols = fields.filter(([k]) => map[k]! >= 0).map(([k, label]) => [k, label] as const);

  return (
    <div className="flex flex-col gap-4">
      {done && <Notice tone="ok">{done}</Notice>}
      {error && <Notice tone="alert">{error}</Notice>}
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
          <div className="flex flex-wrap gap-2">
            <Button onClick={check} disabled={pending} variant={checked ? "default" : "primary"}>
              {pending && !checked ? "Checking…" : "Check rows"}
            </Button>
            {checked && (
              <Button
                variant="primary"
                disabled={pending || valid === 0}
                onClick={() => {
                  if (window.confirm(`Import ${valid} ${spec.label.toLowerCase()}? Rows with problems are skipped.`)) commit();
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
