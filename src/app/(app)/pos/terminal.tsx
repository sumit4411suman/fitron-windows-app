"use client";

import { useActionState, useState } from "react";
import { MinusIcon, PlusIcon, UserCircleIcon, XIcon } from "@phosphor-icons/react";
import { sellAction } from "./actions";
import { Input, Notice, Select, cx } from "@/components/ui";
import { formatInr, formatRupees } from "@/lib/format";
import { METHODS } from "@/lib/validation/billing";

type P = { id: string; sku: string; name: string; category: string; price: number; stock: number | null; low: boolean; gst: boolean };
type M = { code: string; name: string; phone: string; plan: string; due: number };

/** Whole rupees, as the prototype shows them, unless GST leaves paise. */
const money = (paise: number) => (paise % 100 ? formatInr(paise) : formatRupees(paise));
const iconBtn = "grid h-[30px] w-[30px] place-items-center rounded-md border border-line hover:bg-fg/7 disabled:opacity-45";

/** The prototype's POS: product tiles with search / barcode scan on the left, the current sale on the right. */
export function Terminal({ products, members, taxRate }: { products: P[]; members: M[]; taxRate: number }) {
  const [state, action, pending] = useActionState(sellAction, undefined);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [q, setQ] = useState("");
  const [miss, setMiss] = useState("");
  const [mq, setMq] = useState("");
  const [who, setWho] = useState<M | null>(null);
  const pq = q.trim().toLowerCase();
  const shown = products.filter((p) => !pq || `${p.name} ${p.category} ${p.sku}`.toLowerCase().includes(pq));
  const lines = Object.entries(cart)
    .map(([id, qty]) => ({ p: products.find((x) => x.id === id)!, qty }))
    .filter((l) => l.p && l.qty > 0);
  let net = 0;
  let tax = 0;
  for (const l of lines) {
    const n = l.p.price * l.qty;
    net += n;
    tax += l.p.gst ? Math.round((n * taxRate) / 100) : 0;
  }
  const total = net + tax;
  const add = (p: P, d = 1) => setCart((c) => ({ ...c, [p.id]: Math.max(0, Math.min((c[p.id] ?? 0) + d, p.stock ?? 999)) }));
  const mql = mq.trim().toLowerCase();
  const results = mql ? members.filter((m) => m.name.toLowerCase().includes(mql) || m.code.toLowerCase().includes(mql) || m.phone.includes(mql)).slice(0, 6) : [];

  return (
    <div className="flex flex-wrap items-start gap-10">
      <div className="flex min-w-0 flex-[1_1_380px] flex-col gap-3">
        <Input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setMiss("");
          }}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            const hit = products.find((p) => p.sku.toLowerCase() === pq) ?? (shown.length === 1 ? shown[0] : undefined);
            if (hit) {
              add(hit);
              setQ("");
            } else setMiss(`No product matches “${q}”.`);
          }}
          placeholder="Search product or scan barcode, then Enter"
          aria-label="Search product or scan barcode"
        />
        {miss && <Notice tone="alert">{miss}</Notice>}
        <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
          {shown.map((p) => {
            const out = p.stock !== null && p.stock <= (cart[p.id] ?? 0);
            return (
              <button
                key={p.id}
                type="button"
                disabled={out}
                onClick={() => add(p)}
                className="flex min-h-24 flex-col gap-1 rounded-md bg-surface p-3 text-left hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span className="text-[11px] tracking-[0.08em] text-muted uppercase">{p.category}</span>
                <span className="flex-1 text-sm font-semibold">{p.name}</span>
                <span className="flex justify-between text-[13px]">
                  <span>{money(p.price)}</span>
                  <span className={p.low || p.stock === 0 ? "text-alert-700" : "text-muted"}>{p.stock === null ? "Service" : `${p.stock} left`}</span>
                </span>
              </button>
            );
          })}
        </div>
        {!shown.length && <p className="text-sm text-muted">No product matches.</p>}
      </div>

      <form action={action} className="sticky top-4 flex min-w-0 flex-[0_0_320px] flex-col gap-3 rounded-lg bg-surface px-[18px] py-4 max-sm:flex-auto">
        <h3 className="text-xl">Current sale</h3>
        {state?.message && <Notice tone="alert">{state.message}</Notice>}
        {lines.map(({ p, qty }) => (
          <div key={p.id} className="flex items-center gap-2 text-sm">
            <span className="flex-1">{p.name}</span>
            <button type="button" className={iconBtn} onClick={() => add(p, -1)} aria-label={`One less ${p.name}`}>
              <MinusIcon size={14} weight="duotone" />
            </button>
            <span className="min-w-[18px] text-center tabular-nums">{qty}</span>
            <button type="button" className={iconBtn} onClick={() => add(p)} aria-label={`One more ${p.name}`} disabled={p.stock !== null && qty >= p.stock}>
              <PlusIcon size={14} weight="duotone" />
            </button>
            <span className="min-w-[70px] text-right tabular-nums">{money(p.price * qty)}</span>
          </div>
        ))}
        {!lines.length && <p className="text-sm text-muted">Tap a product to add it.</p>}
        <div className="flex justify-between pt-1.5 text-xl font-semibold">
          <span>Total</span>
          <span className="tabular-nums">{money(total)}</span>
        </div>
        {tax > 0 && <div className="-mt-2 text-right text-xs text-muted">incl. {money(tax)} GST</div>}
        <input type="hidden" name="items" value={JSON.stringify(lines.map((l) => ({ productId: l.p.id, qty: l.qty })))} />
        <input type="hidden" name="member" value={who?.code ?? ""} />
        <div className="relative flex flex-col gap-[5px] text-sm">
          <span className="text-xs text-fg/70">Customer</span>
          {who ? (
            <div className="flex items-center gap-2.5 rounded-md border border-accent-500 bg-bg px-2.5 py-2">
              <UserCircleIcon size={22} weight="duotone" className="text-accent" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold">{who.name}</div>
                <div className="text-xs text-muted">
                  {who.code} · {who.phone}
                  {who.due > 0 ? ` · ${money(who.due)} due` : ""}
                </div>
              </div>
              <button type="button" className="grid h-8 w-8 place-items-center rounded-md hover:bg-fg/7" onClick={() => setWho(null)} aria-label="Change customer">
                <XIcon size={16} weight="duotone" />
              </button>
            </div>
          ) : (
            <>
              <Input value={mq} onChange={(e) => setMq(e.target.value)} placeholder="Search name, member ID or phone" autoComplete="off" aria-label="Customer" />
              {results.length > 0 && (
                <div className="absolute top-full right-0 left-0 z-20 mt-1 flex flex-col rounded-md border border-line bg-surface p-1 shadow-lg">
                  {results.map((m) => (
                    <button
                      key={m.code}
                      type="button"
                      onClick={() => {
                        setWho(m);
                        setMq("");
                      }}
                      className="rounded-sm px-2.5 py-2 text-left hover:bg-accent-soft"
                    >
                      <div className="text-sm font-semibold">{m.name}</div>
                      <div className="text-xs text-muted">
                        {m.code} · {m.phone}
                        {m.plan ? ` · ${m.plan}` : ""}
                      </div>
                    </button>
                  ))}
                </div>
              )}
              <span className={cx("text-xs text-muted", mql.length >= 2 && !results.length && "text-alert")}>
                {mql.length >= 2 && !results.length ? "No member matches." : "Leave empty for a walk-in customer."}
              </span>
            </>
          )}
        </div>
        <label className="flex flex-col gap-[5px] text-sm">
          <span className="text-xs text-fg/70">Payment method</span>
          <Select name="method" defaultValue="Cash">
            {METHODS.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </Select>
        </label>
        <input type="hidden" name="txnRef" value="" />
        <button
          disabled={pending || !lines.length}
          className="inline-flex py-2.5 leading-[1.2] items-center justify-center rounded-md bg-accent p-3 text-sm font-semibold text-accent-ink hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-45"
        >
          {pending ? "Recording…" : `Charge ${money(total)} and print receipt`}
        </button>
      </form>
    </div>
  );
}
