"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Input } from "@/components/ui";
import { formatInr } from "@/lib/format";
import { MAX_SERVICE_RUPEES } from "@/lib/domain/services";
import { cancelAutoRenewalAction } from "./actions";
import { PayButton } from "./pay-button";

/** One add-on: fixed ones just pay; quoted ones take the amount agreed with FITRON (never below the starting price). */
export function ServicePay({ service, name, price, quoted }: { service: string; name: string; price: number; quoted: boolean }) {
  const [rupees, setRupees] = useState(String(price / 100));
  const n = Number(rupees);
  const valid = !quoted || (Number.isInteger(n) && n * 100 >= price && n <= MAX_SERVICE_RUPEES);
  const amount = quoted && valid ? n : undefined;
  return (
    <div className="flex flex-wrap items-end gap-2">
      {quoted && (
        <label className="flex flex-col gap-1 text-xs text-muted">
          Agreed amount (₹, GST included)
          <Input value={rupees} onChange={(e) => setRupees(e.target.value.replace(/[^\d]/g, ""))} inputMode="numeric" aria-label={`Amount for ${name} in rupees`} className="w-36" maxLength={8} />
        </label>
      )}
      <div className={valid ? undefined : "pointer-events-none opacity-50"}>
        <PayButton what={{ kind: "SERVICE", service, amount }} fixedCycle="ONCE" label={`Pay ${formatInr(quoted && valid ? n * 100 : price).replace(/\.00$/, "")}`} success={`Paid. ${name} is in Payment history below.`} />
      </div>
    </div>
  );
}

/** Stops a plan or extra branch renewing by itself. What is already paid stays valid. */
export function StopRenewal({ id, what, retry = false }: { id: string; what: string; retry?: boolean }) {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const stop = () => {
    if (!window.confirm(`Stop ${what} renewing automatically? It stays active until the end of the period you already paid for, then it ends.`)) return;
    start(async () => {
      const r = await cancelAutoRenewalAction(id);
      if (!r.ok) return setMsg(r.error);
      router.refresh();
    });
  };
  return (
    <div className="flex flex-col items-end gap-1">
      <Button type="button" onClick={stop} disabled={pending}>
        {pending ? "Stopping…" : retry ? "Try stopping again" : "Stop renewing"}
      </Button>
      {msg && <p className="text-xs text-alert">{msg}</p>}
    </div>
  );
}
