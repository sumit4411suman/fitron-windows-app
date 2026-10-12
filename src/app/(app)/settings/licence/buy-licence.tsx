"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Notice } from "@/components/ui";
import { formatInr } from "@/lib/format";
import { collectLicenceAction, markBuyOpenedAction } from "./actions";

export type PlanPrice = { key: string; name: string; monthly: number; yearly: number; limit: string };

const EVERY_MS = 5_000;
const FOR_MS = 30 * 60_000;
const rupees = (p: number) => formatInr(p).replace(/\.00$/, "");

/**
 * Buy or renew on fitron.in: the link opens the buy page in the computer's browser; this page then asks fitron.in every
 * few seconds for the licence (for half an hour), and installs it when it is paid. FITRON also looks every hour.
 */
export function BuyLicence({ url, plans, waitingAlready }: { url: string; plans: PlanPrice[]; waitingAlready: boolean }) {
  const router = useRouter();
  const [since, setSince] = useState<number | null>(null);
  const [msg, setMsg] = useState<{ tone: "ok" | "alert" | "neutral"; text: string } | null>(waitingAlready ? { tone: "neutral", text: "Waiting for a payment started on fitron.in. FITRON installs the licence by itself when it is paid." } : null);
  const [pending, start] = useTransition();
  const busy = useRef(false);

  const check = (quiet: boolean) => {
    if (busy.current) return;
    busy.current = true;
    start(async () => {
      try {
        const r = await collectLicenceAction();
        if (r.state === "installed") {
          setSince(null);
          setMsg({ tone: "ok", text: r.message });
          router.refresh();
        } else if (!quiet || r.state !== "none") setMsg({ tone: r.state === "problem" ? "alert" : "neutral", text: r.message });
      } finally {
        busy.current = false;
      }
    });
  };

  useEffect(() => {
    if (since === null) return;
    const t = setInterval(() => (Date.now() - since > FOR_MS ? setSince(null) : check(true)), EVERY_MS);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [since]);

  return (
    <div className="flex flex-col gap-3.5">
      <div className="grid gap-2 sm:grid-cols-3">
        {plans.map((p) => (
          <div key={p.key} className="rounded-md border border-line p-3 text-sm">
            <div className="font-semibold">{p.name}</div>
            <div>
              {rupees(p.yearly)}/year · {rupees(p.monthly)}/month
            </div>
            <div className="text-[13px] text-muted">{p.limit}</div>
          </div>
        ))}
      </div>
      <p className="m-0 text-[13px] text-muted">
        Prices include GST. Paying opens fitron.in in your browser (it needs the internet). The licence is made for this computer and installs itself here; a renewal starts when the current licence ends. Only this computer&apos;s installation id goes to fitron.in, never your members or books.
      </p>
      <div className="flex flex-wrap gap-2">
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="buy-licence"
          className="inline-flex items-center justify-center gap-1.5 rounded-md border border-transparent bg-accent px-[18px] py-2.5 text-sm leading-[1.2] font-semibold whitespace-nowrap text-accent-ink no-underline hover:bg-accent-hover"
          onClick={() => {
            void markBuyOpenedAction();
            setSince(Date.now());
            setMsg({ tone: "neutral", text: "fitron.in opened in your browser. Pay there; this page installs the licence as soon as it is paid." });
          }}
        >
          Buy or renew on fitron.in
        </a>
        <Button type="button" onClick={() => check(false)} disabled={pending}>
          {pending ? "Checking…" : "Check now"}
        </Button>
      </div>
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
    </div>
  );
}
