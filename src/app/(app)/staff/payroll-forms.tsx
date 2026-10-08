"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { saveAdvance, savePayment, saveSalary } from "./actions";
import { Field, Input, Notice, Select } from "@/components/ui";
import { METHODS } from "@/lib/validation/billing";
import { netPay } from "@/lib/domain/payroll";
import { formatRupees } from "@/lib/format";

const btn = "inline-flex py-2.5 leading-[1.2] items-center gap-1.5 rounded-md border px-[18px] text-sm font-semibold whitespace-nowrap";
function Buttons({ close, label, pending }: { close: string; label: string; pending: boolean }) {
  return (
    <div className="flex justify-end gap-2.5">
      <Link href={close} scroll={false} className={`${btn} border-line hover:bg-fg/7`}>
        Cancel
      </Link>
      <button disabled={pending} className={`${btn} border-transparent bg-accent text-accent-ink hover:bg-accent-hover`}>
        {pending ? "Saving…" : label}
      </button>
    </div>
  );
}

type Sent = Record<string, string> | undefined;

export function SalaryForm({ id, close, tab, month, init }: { id: string; close: string; tab: string; month: string; init: { salary: string; ptRate: string; joinedOn: string; payAccount: string } }) {
  const [state, action, pending] = useActionState(saveSalary.bind(null, id), undefined);
  const e = state?.errors ?? {};
  const sent = state?.values as Sent;
  return (
    <form action={action} key={state?.nonce} className="flex flex-col gap-3">
      <input type="hidden" name="tab" value={tab} />
      <input type="hidden" name="month" value={month} />
      {state?.message && <Notice tone="alert">{state.message}</Notice>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Monthly salary (₹)" error={e.salary}>
          <Input name="salary" type="number" min={0} step="any" defaultValue={sent?.salary ?? init.salary} required />
        </Field>
        <Field label="PT commission (%)" error={e.ptRate}>
          <Input name="ptRate" type="number" min={0} max={100} defaultValue={sent?.ptRate ?? init.ptRate} />
        </Field>
        <Field label="Joining date" error={e.joinedOn}>
          <Input name="joinedOn" type="date" defaultValue={sent?.joinedOn ?? init.joinedOn} />
        </Field>
        <Field label="Bank account / UPI for salary" error={e.payAccount} className="sm:col-span-2">
          <Input name="payAccount" placeholder="name@okaxis or A/c + IFSC" defaultValue={sent?.payAccount ?? init.payAccount} />
        </Field>
      </div>
      <Buttons close={close} label="Save" pending={pending} />
    </form>
  );
}

export function AdvanceForm({ id, close, tab, month }: { id: string; close: string; tab: string; month: string }) {
  const [state, action, pending] = useActionState(saveAdvance.bind(null, id), undefined);
  const e = state?.errors ?? {};
  const sent = state?.values as Sent;
  return (
    <form action={action} key={state?.nonce} className="flex flex-col gap-3">
      <input type="hidden" name="tab" value={tab} />
      <input type="hidden" name="month" value={month} />
      {state?.message && <Notice tone="alert">{state.message}</Notice>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Amount (₹)" error={e.amount}>
          <Input name="amount" inputMode="decimal" defaultValue={sent?.amount} required />
        </Field>
        <Field label="Paid by" error={e.method}>
          <Select name="method" defaultValue={sent?.method ?? "Cash"}>
            {METHODS.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </Select>
        </Field>
        <Field label="Note" error={e.note} className="sm:col-span-2">
          <Input name="note" defaultValue={sent?.note} />
        </Field>
      </div>
      <Buttons close={close} label="Record advance" pending={pending} />
    </form>
  );
}

const paise = (v: string) => {
  const n = Number(v.replace(/[₹,\s]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};

export function PayForm({ id, close, tab, month, kind, init }: { id: string; close: string; tab: string; month: string; kind: "Trainer" | "Staff"; init: { base: string; commission: string; advance: string } }) {
  const [state, action, pending] = useActionState(savePayment.bind(null, id), undefined);
  const e = state?.errors ?? {};
  const sent = state?.values as Sent;
  const [v, setV] = useState({ base: sent?.base ?? init.base, commission: sent?.commission ?? init.commission, bonus: sent?.bonus ?? "0", deductions: sent?.deductions ?? "0", advance: sent?.advance ?? init.advance });
  const net = Math.max(0, netPay({ base: paise(v.base), commission: paise(v.commission), bonus: paise(v.bonus), deductions: paise(v.deductions), advance: paise(v.advance) }));
  const bind = (k: keyof typeof v) => ({ name: k, inputMode: "decimal" as const, value: v[k], onChange: (ev: React.ChangeEvent<HTMLInputElement>) => setV((o) => ({ ...o, [k]: ev.target.value })) });
  return (
    <>
      <form action={action} key={state?.nonce} className="flex flex-col gap-3">
        <input type="hidden" name="tab" value={tab} />
        <input type="hidden" name="month" value={month} />
        {state?.message && <Notice tone="alert">{state.message}</Notice>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Base salary (₹)" error={e.base}>
            <Input {...bind("base")} />
          </Field>
          <Field label="Days worked" error={e.days}>
            <Input name="days" type="number" min={0} max={31} defaultValue={sent?.days ?? "26"} />
          </Field>
          <Field label="PT commission (₹)" error={e.commission}>
            <Input {...bind("commission")} />
          </Field>
          <Field label="Bonus / overtime (₹)" error={e.bonus}>
            <Input {...bind("bonus")} />
          </Field>
          <Field label="Deductions / leave (₹)" error={e.deductions}>
            <Input {...bind("deductions")} />
          </Field>
          <Field label="Advance recovered (₹)" error={e.advance}>
            <Input {...bind("advance")} />
          </Field>
          <Field label="Paid by" error={e.method}>
            <Select name="method" defaultValue={sent?.method ?? "Bank Transfer"}>
              {METHODS.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </Select>
          </Field>
          <Field label="Transaction / cheque no." error={e.reference}>
            <Input name="reference" defaultValue={sent?.reference} />
          </Field>
        </div>
        <Buttons close={close} label={`Pay ${formatRupees(net)}`} pending={pending} />
      </form>
      <p className="m-0 text-[13px] text-muted">
        Net pay {formatRupees(net)} = base + commission + bonus − deductions − advance. It is added to Expenses as {kind} Salary, so Profit &amp; loss updates.
      </p>
    </>
  );
}
