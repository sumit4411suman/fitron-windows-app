"use client";

import { useActionState, useState } from "react";
import { continueSignup } from "./actions";
import { signUpGym } from "../(site)/account-actions";
import { Button, Field, Input, Notice, Select } from "@/components/ui";
import { GoogleLink } from "@/components/google-link";
import { DEFAULT_PLAN, PLANS, findPlan, rupeesLabel, type Cycle } from "@/lib/domain/pricing";
import { gymSignupHref } from "@/lib/domain/site-links";

const MAX_LOGO = 1_048_576;

type Vals = Record<string, string>;
const EMPTY2: Vals = { business: "", phone: "", gymEmail: "", address: "", city: "", state: "", pin: "", tagline: "", website: "", instagram: "" };
const gymPlans = PLANS.filter((p) => p.product === "GYM_ACCOUNTING");

/** Which plan the trial starts on, and how it will be billed once the trial ends. Changeable until the account is created. */
function PlanPicker({ planKey, cycle, onPlan, onCycle }: { planKey: string; cycle: Cycle; onPlan: (k: string) => void; onCycle: (c: Cycle) => void }) {
  const p = findPlan(planKey) ?? findPlan(DEFAULT_PLAN)!;
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-line p-3">
      <Field label="Your plan">
        <Select value={p.key} onChange={(e) => onPlan(e.target.value)} aria-label="Plan">
          {gymPlans.map((x) => (
            <option key={x.key} value={x.key}>
              {x.name} · {x.memberLimit ? `up to ${x.memberLimit} members` : "unlimited members, multi-branch"}
            </option>
          ))}
        </Select>
      </Field>
      <fieldset className="flex flex-col gap-1.5 text-sm">
        <legend className="mb-1.5 font-semibold">After the 7-day free trial</legend>
        <div className="grid grid-cols-2 gap-2">
          {(["MONTHLY", "YEARLY"] as const).map((c) => (
            <label key={c} className={`flex cursor-pointer flex-col rounded-md border px-3 py-2 ${cycle === c ? "border-accent bg-accent-soft" : "border-line"}`}>
              <span className="flex items-center gap-2 font-semibold">
                <input type="radio" name="plan-cycle" value={c} checked={cycle === c} onChange={() => onCycle(c)} />
                {c === "MONTHLY" ? "Monthly" : "Yearly"}
              </span>
              <span className="text-muted">
                {rupeesLabel(p.price[c])} / {c === "MONTHLY" ? "month" : "year"}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <p className="text-xs text-muted">No card needed. Prices include 18% GST. Nothing is charged unless you choose to pay when the trial ends.</p>
    </div>
  );
}

/**
 * The "Create account" tab: step 1 owner account, step 2 the gym, with the plan picked on fitron.in
 * (changeable here). `google`: back from Google, which has confirmed the email, so it starts at step 2
 * with no password. Both end in the same server actions.
 */
export function CreateAccountForm({ plan, cycle, googleOn, google }: { plan: string; cycle: string; googleOn: boolean; google?: { email: string; name: string } }) {
  const [s1, check, checking] = useActionState(continueSignup, undefined);
  const [s2, create, creating] = useActionState(signUpGym, undefined);
  const [step, setStep] = useState<1 | 2>(google ? 2 : 1);
  const [planKey, setPlanKey] = useState((findPlan(plan) ?? findPlan(DEFAULT_PLAN)!).key);
  const [billing, setBilling] = useState<Cycle>(cycle === "YEARLY" ? "YEARLY" : "MONTHLY");
  const [owner, setOwner] = useState<Vals>({ name: google?.name ?? "", email: google?.email ?? "", password: "" });
  const [agree, setAgree] = useState(false);
  const [gym, setGym] = useState<Vals>(EMPTY2);
  const [logo, setLogo] = useState<{ url: string } | null>(null);
  const [err, setErr] = useState("");
  const [seen, setSeen] = useState<{ a?: string; b?: string }>({});

  // React to a new server answer once (derived during render, not in an effect).
  if (s1?.nonce && s1.nonce !== seen.a) {
    setSeen({ ...seen, a: s1.nonce });
    if (s1.ok) {
      setErr("");
      setGym((g) => ({ ...g, gymEmail: g.gymEmail || owner.email.trim().toLowerCase() }));
      setStep(2);
    } else setErr(s1.message ?? "Check the highlighted fields.");
  }
  if (s2?.nonce && s2.nonce !== seen.b) {
    setSeen({ ...seen, b: s2.nonce });
    setErr(s2.message ?? "");
    setLogo(null); // React resets the form after an action, which clears the chosen file.
    if (s2.values) setGym((g) => ({ ...g, ...Object.fromEntries(Object.keys(EMPTY2).map((k) => [k, String(s2.values?.[k] ?? g[k])])) }));
    // Back from Google there is no step 1 to return to; its errors show in the notice above.
    if (!google && Object.keys(s2.errors ?? {}).some((k) => ["name", "email", "password", "terms"].includes(k))) setStep(1);
  }

  const set1 = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setOwner({ ...owner, [k]: e.target.value });
  const set2 = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setGym({ ...gym, [k]: e.target.value });
  const e1 = s1?.errors ?? {};

  function validate(): string {
    if (gym.business.trim().length < 2) return "Enter your gym name.";
    if (!/^[6-9]\d{9}$/.test(gym.phone.replace(/[\s-]/g, "").replace(/^(\+91|91|0)(?=\d{10}$)/, ""))) return "Gym phone must be 10 digits.";
    if (!/^\S+@\S+\.\S+$/.test(gym.gymEmail.trim())) return "Enter a valid gym email.";
    if (!gym.address.trim() || !gym.city.trim()) return "Enter the address and city.";
    if (!/^\d{6}$/.test(gym.pin.trim())) return "PIN code must be 6 digits.";
    return "";
  }

  function pickLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return setLogo(null);
    if (f.size > MAX_LOGO) {
      e.target.value = "";
      setLogo(null);
      return setErr("Logo must be under 1 MB.");
    }
    setErr("");
    setLogo({ url: URL.createObjectURL(f) });
  }

  const p = findPlan(planKey) ?? findPlan(DEFAULT_PLAN)!;
  const gUrl = `/auth/google?${new URLSearchParams({ for: "signup", plan: p.key, cycle: billing })}`;
  const req = <span className="text-accent"> *</span>;
  const picker = <PlanPicker planKey={p.key} cycle={billing} onPlan={setPlanKey} onCycle={setBilling} />;

  return (
    <>
      <div>
        <h2 className="text-[28px] font-semibold">{step === 1 ? "Create your Fitron account" : "Set up your gym"}</h2>
        <p className="mt-1 text-sm text-muted">
          {google
            ? `Confirmed by Google as ${google.email}. The gym's details are shown on invoices, WhatsApp messages and the sidebar. You can change them later in Settings.`
            : step === 1
              ? "Step 1 of 2 · the owner account for your gym."
              : "Step 2 of 2 · shown on invoices, WhatsApp messages and the sidebar. You can change it later in Settings."}
        </p>
      </div>
      {err && <Notice tone="alert">{err}</Notice>}
      {(step === 1 || google) && picker}
      {step === 1 ? (
        <>
          {googleOn && (
            <GoogleLink
              href={gUrl}
              label="Sign up with Google"
              divider="or with email"
              onClick={(e) => {
                if (!agree) {
                  e.preventDefault();
                  setErr("Tick “I agree to Fitron’s Terms…” below before signing up with Google.");
                }
              }}
            />
          )}
          <form action={check} className="flex flex-col gap-4" noValidate>
            <Field label="Your name" error={e1.name}>
              <Input name="name" autoComplete="name" value={owner.name} onChange={set1("name")} />
            </Field>
            <Field label="Email" error={e1.email}>
              <Input name="email" type="email" autoComplete="email" value={owner.email} onChange={set1("email")} />
            </Field>
            <Field label="Password" error={e1.password} hint="At least 10 characters.">
              <Input name="password" type="password" autoComplete="new-password" value={owner.password} onChange={set1("password")} />
            </Field>
            <label className="flex items-start gap-2 text-[13px]">
              <input type="checkbox" id="ft-agree" name="terms" className="mt-1 accent-[#cfa94f]" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
              <span>
                I agree to Fitron’s <a href="/terms" target="_blank" className="underline">Terms of Service</a>, <a href="/privacy" target="_blank" className="underline">Privacy Policy</a> and{" "}
                <a href="/privacy#dpa" target="_blank" className="underline">Data Processing terms</a> under the DPDP Act, 2023.
              </span>
            </label>
            <Button variant="primary" disabled={checking} className="py-[11px] text-[15px]">{checking ? "Checking…" : "Continue"}</Button>
          </form>
          <p className="text-xs text-muted">The first account becomes Super Admin. Add staff later in Staff &amp; roles.</p>
        </>
      ) : (
        <form
          action={create}
          className="flex flex-col gap-4"
          noValidate
          onSubmit={(e) => {
            const m = validate();
            if (m) {
              e.preventDefault();
              setErr(m);
            }
          }}
        >
          <input type="hidden" name="plan" value={p.key} />
          <input type="hidden" name="cycle" value={billing} />
          {google ? (
            // The server takes the email from Google's own signed cookie and sets no password.
            <input type="hidden" name="google" value="1" />
          ) : (
            (["name", "email", "password"] as const).map((k) => <input key={k} type="hidden" name={k} value={owner[k]} />)
          )}
          <input type="hidden" name="terms" value="on" />
          <input type="hidden" name="source" value="login" />
          {google ? (
            <>
              <Field label="Your name"><Input name="name" autoComplete="name" value={owner.name} onChange={set1("name")} /></Field>
              <Field label="Email" hint="Confirmed by Google. You'll sign in with Google."><Input name="email" type="email" value={google.email} readOnly /></Field>
            </>
          ) : (
            <p className="text-sm text-muted">
              Plan: <b className="text-fg">{p.name}</b>, {billing === "MONTHLY" ? `${rupeesLabel(p.price.MONTHLY)} a month` : `${rupeesLabel(p.price.YEARLY)} a year`} after the trial.{" "}
              <button type="button" className="text-accent underline" onClick={() => { setErr(""); setLogo(null); setStep(1); }}>Change</button>
            </p>
          )}
          <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,170px),1fr))] gap-x-[14px] gap-y-3">
            <Field label={<>Gym name{req}</>} className="col-span-full"><Input name="business" placeholder="Power Haus Gym" autoComplete="organization" value={gym.business} onChange={set2("business")} /></Field>
            <Field label={<>Gym phone{req}</>}><Input name="phone" placeholder="10-digit mobile" type="tel" inputMode="tel" value={gym.phone} onChange={set2("phone")} /></Field>
            <Field label={<>Gym email{req}</>}><Input name="gymEmail" placeholder="hello@yourgym.in" type="email" value={gym.gymEmail} onChange={set2("gymEmail")} /></Field>
            <Field label={<>Address{req}</>} className="col-span-full"><Input name="address" placeholder="Shop / building, area" value={gym.address} onChange={set2("address")} /></Field>
            <Field label={<>City{req}</>}><Input name="city" placeholder="Bokaro" value={gym.city} onChange={set2("city")} /></Field>
            <Field label="State"><Input name="state" placeholder="Jharkhand" value={gym.state} onChange={set2("state")} /></Field>
            <Field label={<>PIN code{req}</>}><Input name="pin" placeholder="827004" inputMode="numeric" maxLength={6} value={gym.pin} onChange={set2("pin")} /></Field>
            <Field label="Tagline"><Input name="tagline" placeholder="Built Stronger" value={gym.tagline} onChange={set2("tagline")} /></Field>
            <Field label="Website"><Input name="website" placeholder="yourgym.in" value={gym.website} onChange={set2("website")} /></Field>
            <Field label="Instagram"><Input name="instagram" placeholder="@yourgym" value={gym.instagram} onChange={set2("instagram")} /></Field>
          </div>
          <div className="flex flex-wrap items-center gap-[14px] rounded-lg border border-dashed border-line p-3">
            <span className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-md border border-line bg-surface text-muted">
              {logo ? (
                // eslint-disable-next-line @next/next/no-img-element -- local object URL preview
                <img src={logo.url} alt="Logo preview" className="size-full object-contain" />
              ) : (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="2" /><path d="m21 16-5-5-8 8" /></svg>
              )}
            </span>
            <label className="inline-flex min-h-9 cursor-pointer items-center rounded-md border border-line px-3 text-sm font-semibold hover:border-fg/45">
              Upload logo
              <input type="file" name="logo" accept="image/png,image/jpeg" hidden onChange={pickLogo} />
            </label>
            <span className="text-xs text-muted">Optional. PNG or JPG up to 1 MB.</span>
          </div>
          <div className="flex gap-2">
            {!google && <Button type="button" variant="ghost" onClick={() => { setErr(""); setLogo(null); setStep(1); }}>Back</Button>}
            <Button variant="primary" disabled={creating} className="flex-1 py-[11px] text-[15px]">{creating ? "Creating your console…" : "Create account and open Fitron"}</Button>
          </div>
          {google && <a href={gymSignupHref({ plan: p.key, cycle: billing })} className="self-center text-sm text-accent underline">Use a different email</a>}
        </form>
      )}
    </>
  );
}
