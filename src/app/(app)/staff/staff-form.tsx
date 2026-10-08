"use client";

import { useActionState } from "react";
import { saveStaff } from "./actions";
import { Button, Card, Field, Input, LinkButton, Notice, Select } from "@/components/ui";

type Values = { name: string; email: string; phone: string; roleId: string; shift: string | null; ptRate: number; branchIds: string[] };

export function StaffForm({
  id,
  values,
  roles,
  branches,
  defaultRole,
}: {
  id?: string;
  values?: Values;
  roles: { id: string; name: string }[];
  branches: { id: string; name: string; active?: boolean }[];
  defaultRole?: string;
}) {
  const [state, action, pending] = useActionState(saveStaff.bind(null, id ?? null), undefined);
  const e = state?.errors ?? {};
  const sent = state?.values;
  const pick = <T,>(k: string, fallback: T) => (sent ? ((sent[k] as string | undefined) ?? "") : fallback);
  const sentBranches = sent ? ([] as string[]).concat(sent.branchIds ?? []) : undefined;
  const ORDER = ["", "order-1", "order-2", "order-3", "order-4"];
  const o = (n: number) => (id ? ORDER[n] : "");
  return (
    <form action={action} key={state?.nonce} className="flex flex-col gap-4">
      {state?.message && <Notice tone="alert">{state.message}</Notice>}
      <Card>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" error={e.name} className={o(4)}>
            <Input name="name" defaultValue={pick("name", values?.name)} required />
          </Field>
          <Field label="Role" error={e.roleId} className={o(1)}>
            <Select name="roleId" defaultValue={pick("roleId", values?.roleId ?? defaultRole ?? "")} required>
              <option value="" disabled>
                Choose
              </option>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Email (login)" error={e.email} className={o(4)}>
            <Input name="email" type="email" defaultValue={pick("email", values?.email)} required />
          </Field>
          <Field label="Mobile" error={e.phone} className={o(4)}>
            <Input name="phone" type="tel" inputMode="numeric" defaultValue={pick("phone", values?.phone)} required />
          </Field>
          <Field label="Shift" error={e.shift} className={o(3)}>
            <Input name="shift" defaultValue={pick("shift", values?.shift ?? "")} placeholder="Morning" />
          </Field>
          <Field label="PT commission (%)" error={e.ptRate} hint="For trainers" className={o(4)}>
            <Input name="ptRate" type="number" min={0} max={100} defaultValue={pick("ptRate", values?.ptRate ?? 0)} />
          </Field>
          <fieldset className={`sm:col-span-2 ${o(2)}`}>
            <legend className="mb-1.5 text-sm font-semibold">Branches</legend>
            <div className="flex flex-wrap gap-4">
              {branches.map((b) => (
                <label key={b.id} className="flex items-center gap-2 text-sm">
                  {b.active === false ? (
                    <>
                      <input type="checkbox" checked disabled className="size-4" />
                      <input type="hidden" name="branchIds" value={b.id} />
                      {b.name} (closed)
                    </>
                  ) : (
                    <>
                      <input type="checkbox" name="branchIds" value={b.id} defaultChecked={sentBranches ? sentBranches.includes(b.id) : (values?.branchIds.includes(b.id) ?? branches.length === 1)} className="size-4" />
                      {b.name}
                    </>
                  )}
                </label>
              ))}
            </div>
            {e.branchIds?.map((x) => <p key={x} className="mt-1 text-xs text-alert">{x}</p>)}
          </fieldset>
          <Field label={id ? "New password" : "First password"} error={e.password} hint={id ? "Leave empty to keep the current password. Setting one signs them out everywhere." : "At least 8 characters. Share it with them privately."} className={o(4)}>
            <Input name="password" type="password" autoComplete="new-password" required={!id} />
          </Field>
        </div>
      </Card>
      <div className="flex gap-2">
        <Button variant="primary" disabled={pending}>
          {pending ? "Saving…" : id ? "Save" : "Add staff"}
        </Button>
        <LinkButton href="/staff">Cancel</LinkButton>
      </div>
      <p className="m-0 text-[13px] text-muted">{id ? "The new role applies the next time they open Fitron. What each role can open is shown in the permissions table." : "What they can open depends on the role; see the permissions table."}</p>
    </form>
  );
}
