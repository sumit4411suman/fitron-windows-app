"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Notice } from "@/components/ui";
import { formatInr } from "@/lib/format";
import { collectLicenceAction, openBuyAction } from "./actions";

export type PlanPrice = { key: string; name: string; monthly: number; yearly: number; limit: string };

const EVERY_MS = 5_000;
const FOR_MS = 30 * 60_000;
const rupees = (p: number) => formatInr(p).replace(/\.00$/, "");

/**
 * Buy or renew on fitron.in: the button opens the buy page in the computer's browser (FITRON's server starts it, so it
 * does not depend on the window opening links); this page then asks fitron.in every few seconds for the licence (for
 * half an hour), and installs it when it is paid. FITRON also looks every hour. The address is always there to copy,
 * for a computer where the browser does not open.
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
        Prices include GST. Paying opens fitron.in in your browser (it needs the internet). The licence is made for this computer and installs itself here; a renewal starts when the current licence ends. Only this computer&apos;s installation id goes to fitron.in, never your members or books.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="primary" onClick={() => void open()} disabled={opening} data-testid="buy-licence">
          {opening ? "Opening fitron.in…" : "Buy or renew on fitron.in"}
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
        <button type="button" className="self-start text-[13px] text-muted underline" onClick={() => setShowUrl(true)}>
          Browser didn&apos;t open? Show the address to copy
        </button>
      )}
    </div>
  );
}
