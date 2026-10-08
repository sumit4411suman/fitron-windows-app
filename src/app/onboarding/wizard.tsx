"use client";

import { useState, useTransition, type ReactNode } from "react";
import { ArrowLeftIcon, ArrowRightIcon, CheckIcon, PlusIcon, TrashIcon } from "@phosphor-icons/react";
import { Logo } from "@/components/logo";
import { Button, Field, Input, Notice, Select, cx } from "@/components/ui";
import {
  GST_RATES,
  GST_TYPES,
  STAFF_ROLES,
  STEP_INFO,
  emptyPlan,
  emptyStaff,
  firstInvalid,
  reviewRows,
  staffRows,
  validateStep,
  type OnboardingForm,
  type PlanRow,
  type StaffRow,
  type StepKey,
} from "@/lib/domain/onboarding";
import { finishAction, saveStepAction, skipAction } from "./actions";

function Check({ label, checked, onChange, hint }: { label: ReactNode; checked: boolean; onChange: (on: boolean) => void; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 text-[15px]">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 size-[18px] shrink-0 accent-accent" />
      <span>
        {label}
        {hint && <span className="block text-xs text-muted">{hint}</span>}
      </span>
    </label>
  );
}

const Grid = ({ children }: { children: ReactNode }) => <div className="grid gap-x-6 gap-y-[18px] sm:grid-cols-2">{children}</div>;

/** The setup wizard: a rail of steps on the left, the current step's questions on the right (prototype `onboard`). */
export function Wizard({ steps, initialForm, initialIndex }: { steps: StepKey[]; initialForm: OnboardingForm; initialIndex: number }) {
  const [form, setForm] = useState(initialForm);
  const [i, setI] = useState(initialIndex);
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();
  const key = steps[i]!;
  const info = STEP_INFO[key];
  const last = i === steps.length - 1;
  const pct = Math.round((i / Math.max(1, steps.length - 1)) * 100);

  const patch = <K extends "tax" | "branch" | "wa" | "opening">(k: K, p: Partial<OnboardingForm[K]>) => {
    setForm((f) => ({ ...f, [k]: { ...f[k], ...p } }));
    setErr("");
  };
  const setRow = (idx: number, p: Partial<PlanRow>) => {
    setForm((f) => ({ ...f, rows: f.rows.map((r, j) => (j === idx ? { ...r, ...p } : r)) }));
    setErr("");
  };
  const setStaff = (idx: number, p: Partial<StaffRow>) => {
    setForm((f) => ({ ...f, staff: f.staff.map((r, j) => (j === idx ? { ...r, ...p } : r)) }));
    setErr("");
  };

  const goTo = (idx: number) => {
    setI(idx);
    setErr("");
    window.scrollTo({ top: 0 });
  };

  function next() {
    if (last) {
      const bad = firstInvalid(steps, form);
      if (bad) {
        goTo(steps.indexOf(bad.step));
        return setErr(bad.message);
      }
    } else {
      const message = validateStep(key, form);
      if (message) return setErr(message);
    }
    setErr("");
    start(async () => {
      const r = last ? await finishAction(form) : await saveStepAction(key, form);
      // Finishing leaves the page for the dashboard, so only a refusal or a saved step comes back here.
      if (r && !r.ok) {
        if (r.step && steps.includes(r.step)) setI(steps.indexOf(r.step));
        return setErr(r.error);
      }
      if (!last) goTo(i + 1);
    });
  }

  const noStaff = key === "staff" && staffRows(form).length === 0;
  const nextLabel = last ? "Finish setup" : noStaff ? "Skip for now" : "Continue";

  return (
    <div className="grid min-h-screen lg:grid-cols-[320px_minmax(0,1fr)]">
      {/* Phones and tablets: a slim header with the progress instead of the rail. */}
      <header className="flex flex-col gap-3 border-b border-line-soft bg-surface px-4 py-4 lg:hidden">
        <div className="flex items-center justify-between gap-3">
          <Logo size={32} />
          <span className="text-xs text-muted">
            Step {i + 1} of {steps.length}
          </span>
        </div>
        <div role="progressbar" aria-label="Setup progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className="h-1 overflow-hidden rounded-sm bg-fg/12">
          <div className="h-full bg-accent transition-[width]" style={{ width: `${pct}%` }} />
        </div>
      </header>

      <aside className="hidden flex-col gap-7 border-r border-line-soft bg-surface px-8 pt-10 pb-8 lg:flex">
        <div className="flex flex-col gap-2">
          <Logo size={46} />
          <span className="text-[11px] tracking-[0.14em] text-muted uppercase">Fitron gym accounting solution</span>
        </div>
        <div className="flex flex-col gap-1.5">
          <div className="flex justify-between text-xs text-muted">
            <span>Account setup</span>
            <span>
              Step {i + 1} of {steps.length}
            </span>
          </div>
          <div role="progressbar" aria-label="Setup progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className="h-1 overflow-hidden rounded-sm bg-fg/12">
            <div className="h-full bg-accent transition-[width]" style={{ width: `${pct}%` }} />
          </div>
        </div>
        <ol className="flex flex-col gap-1">
          {steps.map((k, idx) => {
            const done = idx < i;
            const here = idx === i;
            const body = (
              <>
                <span className={cx("grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold", done || here ? "bg-accent text-accent-ink" : "bg-fg/12 text-muted")}>{done ? <CheckIcon size={14} weight="bold" /> : idx + 1}</span>
                <span className="flex flex-col text-left">
                  <span className={cx("text-[15px]", here ? "font-semibold" : done ? "font-normal" : "font-normal text-fg/80")}>{STEP_INFO[k].label}</span>
                  <span className="text-xs text-muted">{STEP_INFO[k].desc}</span>
                </span>
              </>
            );
            const cls = cx("flex items-center gap-3 rounded-md px-3 py-2.5", here && "bg-accent-soft");
            return (
              <li key={k} aria-current={here ? "step" : undefined}>
                {done ? (
                  <button type="button" onClick={() => goTo(idx)} className={cx(cls, "w-full hover:bg-fg/6")}>
                    {body}
                  </button>
                ) : (
                  <div className={cls}>{body}</div>
                )}
              </li>
            );
          })}
        </ol>
        <form action={skipAction} className="mt-auto">
          <button className="text-xs text-muted underline-offset-2 hover:text-fg hover:underline">I&apos;ll finish this later</button>
        </form>
      </aside>

      <main className="flex min-w-0 flex-col px-5 pt-8 pb-6 sm:px-10 lg:px-16 lg:pt-14">
        <div className="flex w-full max-w-[720px] flex-1 flex-col gap-6">
          <div>
            {/* The side column with "I'll finish this later" is hidden below the lg breakpoint, so phones get their own. */}
            <form action={skipAction} className="mb-3 flex justify-end lg:hidden">
              <button className="text-xs text-muted underline underline-offset-2 hover:text-fg">I&apos;ll finish this later</button>
            </form>
            <div className="text-[11px] tracking-[0.12em] text-accent uppercase">Set up your gym</div>
            <h1 className="mt-1 mb-1.5 text-[clamp(28px,3.4vw,38px)] leading-[1.1]">{info.title}</h1>
            <p className="max-w-[600px] text-[15px] text-fg/75">{info.sub}</p>
          </div>

          <div className="flex flex-col gap-5">
            {key === "tax" && (
              <>
                <Check label="My gym is GST registered and charges GST" checked={form.tax.gst} onChange={(gst) => patch("tax", { gst })} />
                {form.tax.gst && (
                  <Grid>
                    <Field label="GSTIN *" hint="Printed on your invoices, e.g. 20ABCDE1234F1Z5.">
                      <Input value={form.tax.gstin} onChange={(e) => patch("tax", { gstin: e.target.value.toUpperCase() })} maxLength={15} placeholder="20ABCDE1234F1Z5" autoCapitalize="characters" className="uppercase" />
                    </Field>
                    <Field label="GST rate (%)">
                      <Select value={form.tax.rate} onChange={(e) => patch("tax", { rate: e.target.value })}>
                        {GST_RATES.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Tax type">
                      <Select value={form.tax.type} onChange={(e) => patch("tax", { type: e.target.value as (typeof GST_TYPES)[number] })}>
                        <option value="CGST+SGST">CGST + SGST (inside your state)</option>
                        <option value="IGST">IGST (other states)</option>
                      </Select>
                    </Field>
                  </Grid>
                )}
                <Grid>
                  <Field label="Invoice prefix *" hint="Invoices read like INV-1001.">
                    <Input value={form.tax.prefix} onChange={(e) => patch("tax", { prefix: e.target.value.toUpperCase() })} maxLength={10} placeholder="INV-" autoCapitalize="characters" className="uppercase" />
                  </Field>
                  <Field label="First invoice number *" hint="Moving from another system? Carry on from your last number.">
                    <Input value={form.tax.start} onChange={(e) => patch("tax", { start: e.target.value })} inputMode="numeric" />
                  </Field>
                </Grid>
              </>
            )}

            {key === "branch" && (
              <Grid>
                <Field label="Branch name *" hint="Short name for the branch switcher, e.g. Main or City Centre.">
                  <Input value={form.branch.short} onChange={(e) => patch("branch", { short: e.target.value })} maxLength={30} placeholder="City Centre" />
                </Field>
                <Field label="Opening hours *">
                  <Input value={form.branch.hours} onChange={(e) => patch("branch", { hours: e.target.value })} maxLength={40} placeholder="06:00 – 22:00" />
                </Field>
                <Field label="Branch manager" className="sm:col-span-2">
                  <Input value={form.branch.manager} onChange={(e) => patch("branch", { manager: e.target.value })} maxLength={80} />
                </Field>
              </Grid>
            )}

            {key === "plans" && (
              <div className="flex flex-col gap-3">
                {form.rows.map((r, idx) => (
                  <div key={idx} className="grid grid-cols-2 items-end gap-3 rounded-lg border border-line p-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1.2fr)_36px]">
                    <Field label="Plan name" className="col-span-2 sm:col-span-1">
                      <Input value={r.name} onChange={(e) => setRow(idx, { name: e.target.value })} maxLength={80} placeholder="Monthly" />
                    </Field>
                    <Field label="Months">
                      <Input value={r.months} onChange={(e) => setRow(idx, { months: e.target.value })} inputMode="numeric" />
                    </Field>
                    <Field label="Price (₹)">
                      <Input value={r.price} onChange={(e) => setRow(idx, { price: e.target.value })} inputMode="decimal" placeholder="1500" />
                    </Field>
                    <Field label="Joining fee (₹)">
                      <Input value={r.regFee} onChange={(e) => setRow(idx, { regFee: e.target.value })} inputMode="decimal" />
                    </Field>
                    <button
                      type="button"
                      aria-label={`Remove plan ${r.name || idx + 1}`}
                      onClick={() => setForm((f) => ({ ...f, rows: f.rows.filter((_, j) => j !== idx) }))}
                      disabled={form.rows.length <= 1}
                      className="grid size-9 place-items-center rounded-md text-muted hover:bg-fg/8 hover:text-alert disabled:opacity-30"
                    >
                      <TrashIcon size={18} />
                    </button>
                  </div>
                ))}
                <div>
                  <Button type="button" onClick={() => setForm((f) => ({ ...f, rows: [...f.rows, emptyPlan()] }))} disabled={form.rows.length >= 12}>
                    <PlusIcon size={16} /> Add a plan
                  </Button>
                </div>
                <p className="text-[13px] text-muted">Prices are what a member pays before GST. You can add personal training, discounts and category prices later in Plans &amp; offers.</p>
              </div>
            )}

            {key === "staff" && (
              <div className="flex flex-col gap-3">
                {form.staff.map((s, idx) => (
                  <div key={idx} className="flex flex-col gap-3 rounded-lg border border-line p-3">
                    <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
                      <Field label="Name">
                        <Input value={s.name} onChange={(e) => setStaff(idx, { name: e.target.value })} maxLength={120} autoComplete="off" />
                      </Field>
                      <Field label="Role">
                        <Select value={s.role} onChange={(e) => setStaff(idx, { role: e.target.value as StaffRow["role"] })}>
                          {STAFF_ROLES.map((r) => (
                            <option key={r} value={r}>
                              {r}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <Field label="Mobile">
                        <Input value={s.phone} onChange={(e) => setStaff(idx, { phone: e.target.value })} inputMode="tel" placeholder="10-digit mobile" autoComplete="off" />
                      </Field>
                      <Field label="Email (they sign in with it)">
                        <Input value={s.email} onChange={(e) => setStaff(idx, { email: e.target.value })} type="email" autoComplete="off" />
                      </Field>
                      <Field label="First password" hint="At least 8 characters. Tell them in person; they can change it after signing in.">
                        <Input value={s.password} onChange={(e) => setStaff(idx, { password: e.target.value })} type="password" autoComplete="new-password" />
                      </Field>
                    </div>
                    <div>
                      <Button type="button" variant="ghost" onClick={() => setForm((f) => ({ ...f, staff: f.staff.length > 1 ? f.staff.filter((_, j) => j !== idx) : [emptyStaff()] }))}>
                        <TrashIcon size={16} /> Remove
                      </Button>
                    </div>
                  </div>
                ))}
                <div>
                  <Button type="button" onClick={() => setForm((f) => ({ ...f, staff: [...f.staff, emptyStaff()] }))} disabled={form.staff.length >= 12}>
                    <PlusIcon size={16} /> Add another person
                  </Button>
                </div>
                <p className="text-[13px] text-muted">Leave this empty to start on your own and add people later in Staff &amp; roles. Passwords are used once to create the account and are not kept here.</p>
              </div>
            )}

            {key === "whatsapp" && (
              <div className="flex flex-col gap-3.5">
                <Check label="Welcome message when a member joins" checked={form.wa.welcome} onChange={(welcome) => patch("wa", { welcome })} />
                <Check label="Reminder 7 days before expiry" checked={form.wa.d7} onChange={(d7) => patch("wa", { d7 })} />
                <Check label="Reminder 3 days before expiry" checked={form.wa.d3} onChange={(d3) => patch("wa", { d3 })} />
                <Check label="Reminder 1 day before expiry" checked={form.wa.d1} onChange={(d1) => patch("wa", { d1 })} />
                <Check label="Message on the day it expires" checked={form.wa.d0} onChange={(d0) => patch("wa", { d0 })} />
                <Check label="Birthday wishes" checked={form.wa.birthday} onChange={(birthday) => patch("wa", { birthday })} />
                <p className="text-[13px] text-muted">Until you connect your WhatsApp number in Settings › WhatsApp, messages are written to the log and nothing is sent to members.</p>
              </div>
            )}

            {key === "opening" && (
              <Grid>
                <Field label="Cash in hand today (₹)">
                  <Input value={form.opening.cash} onChange={(e) => patch("opening", { cash: e.target.value })} inputMode="decimal" placeholder="0" />
                </Field>
                <Field label="Bank balance today (₹)">
                  <Input value={form.opening.bank} onChange={(e) => patch("opening", { bank: e.target.value })} inputMode="decimal" placeholder="0" />
                </Field>
              </Grid>
            )}

            {key === "start" && (
              <div className="flex flex-col gap-3" role="radiogroup" aria-label="How to start">
                {(
                  [
                    ["empty", "Start with an empty gym", "No sample data. Add members one by one."],
                    ["import", "Import my members", "Start empty, then upload your Excel or CSV member list. You go to the import page next."],
                  ] as const
                ).map(([m, label, sub]) => (
                  <label key={m} className={cx("flex cursor-pointer items-start gap-3 rounded-lg border px-4 py-3.5", form.mode === m ? "border-accent bg-accent-soft" : "border-line hover:border-fg/45")}>
                    <input type="radio" name="mode" value={m} checked={form.mode === m} onChange={() => setForm((f) => ({ ...f, mode: m }))} className="mt-1 accent-accent" />
                    <span>
                      <span className="block font-semibold">{label}</span>
                      <span className="block text-sm text-muted">{sub}</span>
                    </span>
                  </label>
                ))}
              </div>
            )}

            {key === "review" && (
              <dl className="flex flex-col divide-y divide-line-soft rounded-lg border border-line">
                {reviewRows(form, steps).map((r) => (
                  <div key={r.k} className="grid gap-1 px-4 py-3 text-sm sm:grid-cols-[170px_minmax(0,1fr)] sm:gap-4">
                    <dt className="text-muted">{r.k}</dt>
                    <dd className="font-medium break-words">{r.v}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>

          {err && (
            <div role="alert">
              <Notice tone="alert">{err}</Notice>
            </div>
          )}

          <div className="mt-auto flex items-center justify-between gap-3 border-t border-line pt-5">
            {i > 0 ? (
              <Button type="button" onClick={() => goTo(i - 1)} disabled={pending}>
                <ArrowLeftIcon size={16} /> Back
              </Button>
            ) : (
              <span />
            )}
            <Button type="button" variant="primary" onClick={next} disabled={pending}>
              {pending ? "Saving…" : nextLabel}
              {!pending && !last && <ArrowRightIcon size={16} />}
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
}
