"use client";

import { useState } from "react";
import { CheckIcon } from "@phosphor-icons/react";
import { PayButton } from "@/app/(app)/settings/billing/pay-button";
import { rupeesLabel } from "@/lib/domain/pricing";
import { formatInr } from "@/lib/format";
import { cx } from "./ui";

export type PlanCard = {
  key: string;
  name: string;
  price: { MONTHLY: number; YEARLY: number };
  /** What paying costs, GST included. */
  total: { MONTHLY: number; YEARLY: number };
  card: { audience: string; limit: string; includes?: string; features: readonly string[]; recommended?: boolean };
};

/** The landing page's Gym Accounting pricing cards, with a Monthly/Yearly switch and Pay. */
/** `autoRenew`: a plan paid for here renews by itself (Razorpay), and the footnote says so. `startCycle`: the billing cycle the gym chose at sign-up. */
export function PlanCards({ plans, current, labels, autoRenew = false, startCycle = "YEARLY" }: { plans: PlanCard[]; current?: string; labels: { current: string; other: string }; autoRenew?: boolean; startCycle?: "MONTHLY" | "YEARLY" }) {
  const [cycle, setCycle] = useState<"MONTHLY" | "YEARLY">(startCycle);
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex overflow-hidden rounded-md border border-line" role="group" aria-label="Billing cycle">
          {(["MONTHLY", "YEARLY"] as const).map((c) => (
            <button key={c} type="button" onClick={() => setCycle(c)} aria-pressed={cycle === c} className={cx("px-4 py-2 text-[13px]", cycle === c ? "bg-accent text-accent-ink" : "text-fg hover:bg-fg/7")}>
              {c === "MONTHLY" ? "Monthly" : "Yearly"}
            </button>
          ))}
        </div>
        <span className="text-[13px] text-accent">Yearly: 2 months free</span>
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,280px),1fr))] gap-4">
        {plans.map((p) => {
          const month = cycle === "YEARLY" ? Math.round(p.price.YEARLY / 12 / 100) * 100 : p.price.MONTHLY;
          return (
            <div key={p.key} className={cx("relative flex flex-col gap-4 rounded-xl border bg-surface p-6", p.card.recommended ? "border-accent" : "border-line", current === p.key && "ring-1 ring-accent")}>
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-xl">{p.name}</h3>
                {current === p.key ? (
                  <span className="rounded-full border border-accent px-2.5 py-0.5 text-[11px] text-accent">Your plan</span>
                ) : (
                  p.card.recommended && <span className="rounded-full bg-accent px-2.5 py-0.5 text-[11px] font-semibold text-accent-ink">Recommended</span>
                )}
              </div>
              <p className="-mt-2 text-sm text-muted">{p.card.audience}</p>
              <div>
                <div className="flex items-baseline gap-1">
                  <span className="text-[36px] leading-none font-semibold">{rupeesLabel(cycle === "YEARLY" ? p.price.YEARLY : p.price.MONTHLY)}</span>
                  <span className="text-sm text-muted">/ {cycle === "YEARLY" ? "year" : "month"}</span>
                </div>
                <div className="mt-1.5 text-[13px] text-muted">
                  {cycle === "YEARLY" ? `≈ ${rupeesLabel(month)} / month · 2 months free` : "Billed monthly"} · GST included
                </div>
              </div>
              <PayButton
                what={{ kind: "PLAN", plan: p.key }}
                fixedCycle={cycle}
                wide
                label={`${current === p.key ? labels.current : labels.other} · ${formatInr(p.total[cycle]).replace(/\.00$/, "")}`}
                prices={p.total}
                success={`Paid. You're on ${p.name}.`}
              />
              <div className="flex flex-col gap-2 border-t border-line pt-4 text-sm">
                <div className="font-semibold">{p.card.limit}</div>
                {p.card.includes && <div className="text-muted">{p.card.includes}</div>}
                {p.card.features.map((f) => (
                  <div key={f} className="flex items-start gap-2">
                    <CheckIcon size={16} weight="bold" className="mt-0.5 flex-none text-accent" />
                    <span>{f}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-muted">Prices in rupees, GST included. Yearly plans are billed upfront.{autoRenew ? " Plans renew automatically until you stop them." : ""} *WhatsApp messaging is subject to usage limits and messaging charges.</p>
    </div>
  );
}
