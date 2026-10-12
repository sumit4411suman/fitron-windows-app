"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Notice } from "@/components/ui";
import { formatInr } from "@/lib/format";
import { collectLicenceAction, openBuyAction, startBuyAction } from "./actions";

export type PlanPrice = { key: string; name: string; monthly: number; yearly: number; limit: string };

const EVERY_MS = 5_000;
const FOR_MS = 30 * 60_000;
const rupees = (p: number) => formatInr(p).replace(/\.00$/, "");

/**
 * Buy or renew on fitron.in, inside FITRON: the button goes to fitron.in's buy page, which the shell shows in FITRON's own
 * payment window (Razorpay, UPI, cards and net banking work there); this page then asks fitron.in every few seconds for
 * the licence (for half an hour), and installs it when it is paid. FITRON also looks every hour. The computer's browser
 * is there as a second way, and the address to copy as a last one.
 */
export function BuyLicence({ url, plans, waitingAlready }: { url: string; plans: PlanPrice[]; waitingAlready: boolean }) {
  const router = useRouter();
  const [since, setSince] = useState<number | null>(null);
  const [msg, setMsg] = useState<{ tone: "ok" | "alert" | "neutral"; text: string } | null>(waitingAlready ? { tone: "neutral", text: "Waiting for a payment started on fitron.in. FITRON installs the licence by itself when it is paid." } : null);
  const [pending, start] = useTransition();
  const [opening, setOpening] = useState(false);
  const [showUrl, setShowUrl] = useState(false);
  const [copied, setCopied] = useState(false);
  const busy = useRef(false);

  const buy = async () => {
    setOpening(true);
    try {
      const r = await startBuyAction();
      if (!r.url) return setMsg({ tone: "alert", text: "This computer has no installation id yet. Restart FITRON and try again." });
      setSince(Date.now());
      setMsg({ tone: "neutral", text: "The payment window is open. Pay there (UPI, card or net banking); this page installs the licence as soon as it is paid." });
      // The shell opens fitron.in's buy page in FITRON's payment window, and this page stays here.
      window.location.assign(r.url);
    } catch {
      setMsg({ tone: "alert", text: "The payment window did not open. Try Pay in my browser instead." });
    } finally {
      setOpening(false);
    }
  };

  const open = async () => {
    setOpening(true);
    try {
      const r = await openBuyAction();
      setSince(Date.now());
      if (r.opened) setMsg({ tone: "neutral", text: "fitron.in is opening in your browser. Pay there; this page installs the licence as soon as it is paid." });
      else {
        setShowUrl(true);
        setMsg({ tone: "alert", text: "Your browser did not open. Copy the address below into Chrome or Edge and pay there; this page installs the licence as soon as it is paid." });
      }
    } catch {
      setShowUrl(true);
      setMsg({ tone: "alert", text: "Your browser did not open. Copy the address below into Chrome or Edge and pay there." });
    } finally {
      setOpening(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setSince((s) => s ?? Date.now());
    } catch {
      setCopied(false);
    }
  };

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
        Prices include GST. You pay in a FITRON window, on fitron.in with Razorpay (it needs the internet); a coupon code goes there too. The licence is made for this computer and installs itself here; a renewal starts when the current licence ends. Only this computer&apos;s installation id goes to fitron.in, never your members or books.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="primary" onClick={() => void buy()} disabled={opening} data-testid="buy-licence">
          {opening ? "Opening…" : "Buy or renew"}
        </Button>
        <Button type="button" onClick={() => check(false)} disabled={pending}>
          {pending ? "Checking…" : "Check now"}
        </Button>
      </div>
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      {showUrl ? (
        <div className="flex flex-col gap-2 text-sm">
          <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} aria-label="The buy page's address" data-testid="buy-licence-url" className="w-full min-h-9 rounded-md border border-line bg-surface px-2.5 py-1.5 font-mono text-xs text-fg" />
          <div>
            <Button type="button" onClick={() => void copy()}>
              {copied ? "Copied" : "Copy address"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted">
          <button type="button" className="underline" onClick={() => void open()} disabled={opening} data-testid="buy-in-browser">
            Pay in my browser instead
          </button>
          <button type="button" className="underline" onClick={() => setShowUrl(true)}>
            Show the address to copy
          </button>
        </div>
      )}
    </div>
  );
}
