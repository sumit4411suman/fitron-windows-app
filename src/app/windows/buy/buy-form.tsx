"use client";

import { useState, useTransition } from "react";
import { Button, Field, Input, Notice } from "@/components/ui";
import { formatInr } from "@/lib/format";
import { confirmWindowsLicenceAction, confirmWindowsLicenceDemoAction, startWindowsLicenceAction } from "./actions";

export type PlanChoice = { key: string; name: string; tagline: string; price: { MONTHLY: number; YEARLY: number }; branches: number; memberLimit: number | null };

type RazorpayCtor = new (o: Record<string, unknown>) => { open(): void; on(ev: string, fn: (r: { error?: { description?: string } }) => void): void };

function loadCheckout(): Promise<RazorpayCtor> {
  const w = window as unknown as { Razorpay?: RazorpayCtor };
  if (w.Razorpay) return Promise.resolve(w.Razorpay);
  return new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = () => (w.Razorpay ? res(w.Razorpay) : rej(new Error("Checkout didn't load")));
    s.onerror = () => rej(new Error("Couldn't load Razorpay Checkout. Check the internet connection."));
    document.head.appendChild(s);
  });
}

const rupees = (paise: number) => formatInr(paise).replace(/\.00$/, "");

/** Pick a plan, say who the licence is for, pay with Razorpay. */
export function BuyForm({ installationId, claim, plans, initialPlan, demo }: { installationId: string; claim: string; plans: PlanChoice[]; initialPlan: string; demo: boolean }) {
  const [plan, setPlan] = useState(initialPlan);
  const [cycle, setCycle] = useState<"MONTHLY" | "YEARLY">("YEARLY");
  const [buyer, setBuyer] = useState({ licensee: "", email: "", phone: "", gstin: "" });
  const [msg, setMsg] = useState<{ tone: "ok" | "alert"; text: string } | null>(null);
  const [paid, setPaid] = useState(false);
  const [pending, start] = useTransition();
  const chosen = plans.find((p) => p.key === plan) ?? plans[0]!;
  const set = (k: keyof typeof buyer) => (e: React.ChangeEvent<HTMLInputElement>) => setBuyer((b) => ({ ...b, [k]: e.target.value }));

  const done = () => {
    setPaid(true);
    setMsg({ tone: "ok", text: "Paid. Thank you. FITRON on your computer installs the licence by itself within a minute while it is open and online (or press Check now in Settings › Licence there). You can close this page. Razorpay emails the receipt." });
  };

  const pay = () =>
    start(async () => {
      setMsg(null);
      const r = await startWindowsLicenceAction({ installationId, claim, plan, cycle, ...buyer });
      if (!r.ok) return setMsg({ tone: "alert", text: r.error });
      const c = r.data;
      if (c.mode === "DEMO") {
        const d = await confirmWindowsLicenceDemoAction(c.id);
        return d.ok ? done() : setMsg({ tone: "alert", text: d.error });
      }
      try {
        const Razorpay = await loadCheckout();
        const rz = new Razorpay({
          key: c.keyId,
          order_id: c.orderId,
          amount: c.total,
          currency: "INR",
          name: c.name,
          description: c.description,
          prefill: c.prefill,
          handler: (resp: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) =>
            start(async () => {
              const ok = await confirmWindowsLicenceAction({ orderId: resp.razorpay_order_id, paymentId: resp.razorpay_payment_id, signature: resp.razorpay_signature });
              if (ok.ok) done();
              else setMsg({ tone: "alert", text: ok.error });
            }),
          modal: { ondismiss: () => setMsg({ tone: "alert", text: "Payment not finished. Nothing was charged; press Pay to try again." }) },
        });
        rz.on("payment.failed", (e) => setMsg({ tone: "alert", text: e.error?.description ?? "The payment failed. Nothing was charged; try again." }));
        rz.open();
      } catch (e) {
        setMsg({ tone: "alert", text: e instanceof Error ? e.message : "Couldn't open the payment." });
      }
    });

  if (paid) return <Notice tone="ok">{msg?.text}</Notice>;
  return (
    <div className="flex flex-col gap-5">
      <div className="flex gap-2" role="radiogroup" aria-label="How often to pay">
        {(["YEARLY", "MONTHLY"] as const).map((c) => (
          <Button key={c} type="button" variant={cycle === c ? "primary" : "default"} aria-pressed={cycle === c} onClick={() => setCycle(c)}>
            {c === "YEARLY" ? "Yearly" : "Monthly"}
          </Button>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-3" role="radiogroup" aria-label="Plan">
        {plans.map((p) => (
          <label key={p.key} className={`flex cursor-pointer flex-col gap-1 rounded-lg border p-4 ${plan === p.key ? "border-accent bg-accent/5" : "border-line"}`}>
            <span className="flex items-center gap-2">
              <input type="radio" name="plan" value={p.key} checked={plan === p.key} onChange={() => setPlan(p.key)} />
              <span className="font-semibold">{p.name}</span>
            </span>
            <span className="text-xl font-semibold">
              {rupees(p.price[cycle])}
              <span className="text-sm font-normal text-muted">/{cycle === "YEARLY" ? "year" : "month"}</span>
            </span>
            <span className="text-[13px] text-muted">{p.tagline}</span>
            <span className="text-[13px] text-muted">
              {p.memberLimit === null ? "Unlimited members" : `Up to ${p.memberLimit} active members`} · {p.branches} branch{p.branches === 1 ? "" : "es"}
            </span>
          </label>
        ))}
      </div>
      <div className="grid gap-3.5 sm:grid-cols-2">
        <Field label="Gym or company name (on the licence)">
          <Input value={buyer.licensee} onChange={set("licensee")} autoComplete="organization" required />
        </Field>
        <Field label="Email (for the receipt)">
          <Input type="email" value={buyer.email} onChange={set("email")} autoComplete="email" required />
        </Field>
        <Field label="Phone (optional)">
          <Input type="tel" value={buyer.phone} onChange={set("phone")} autoComplete="tel" />
        </Field>
        <Field label="GSTIN (optional, for the tax invoice)">
          <Input value={buyer.gstin} onChange={set("gstin")} />
        </Field>
      </div>
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      {demo && <Notice tone="neutral">Payments are not switched on for this server: this is a demonstration, and no money moves.</Notice>}
      <div>
        <Button variant="primary" onClick={pay} disabled={pending} data-testid="windows-pay">
          {pending ? "Please wait…" : `Pay ${rupees(chosen.price[cycle])} · ${chosen.name}, 1 ${cycle === "YEARLY" ? "year" : "month"}`}
        </Button>
      </div>
    </div>
  );
}
