import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth/current";
import { getAsset, toLike } from "@/lib/services/assets";
import { scheduleView } from "@/lib/domain/assets";
import { monthLabel } from "@/lib/domain/periods";
import { XIcon } from "@phosphor-icons/react/dist/ssr";
import { Badge, LinkButton, ListHeader, Segmented, TABLE, TD, TH } from "@/components/ui";
import { ACCOUNTING_TABS, SectionTabs } from "@/components/section-tabs";
import { fmtDate, fmtStamp, formatInr } from "@/lib/format";
import { todayIso, toIso } from "@/lib/services/time";
import { DisposeForm, UndoDisposal } from "../asset-forms";
import { ASSET_STATUS, ASSET_TONE } from "../tone";

export const metadata = { title: "Asset · Fitron" };

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-2">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right">{value || "—"}</dd>
    </div>
  );
}

export default async function AssetPage({ params, searchParams }: PageProps<"/assets/[id]">) {
  const u = await requirePermission("assets.manage");
  const { id } = await params;
  const a = await getAsset(u, id);
  if (!a) notFound();
  const inUse = a.status === "IN_USE";
  const mode = (await searchParams).schedule === "month" ? "month" : "year";
  const rows = scheduleView(toLike(a), todayIso().slice(0, 7), mode);
  const meta = [a.category, `Bought ${fmtDate(a.purchaseDate)}`, a.vendor, a.serial ? `Serial ${a.serial}` : "", a.billNo ? `Bill ${a.billNo}` : "", a.expense?.method, a.expense ? `Cash book ${a.expense.code}` : ""].filter(Boolean).join(" · ");
  const branchLabel = u.branch === "ALL" ? "All branches (consolidated)" : (u.branches.find((b) => b.id === u.branch)?.name ?? "");
  const h3 = "m-0 text-xl";
  return (
    <div className="flex flex-col gap-7">
      <ListHeader kicker={branchLabel} title="Accounting" />
      <SectionTabs u={u} className="mb-0" tabs={ACCOUNTING_TABS} current="/assets" />
      <section className="grid gap-x-14 gap-y-10 pt-2 [grid-template-columns:repeat(auto-fit,minmax(min(100%,340px),1fr))]">
        <div className="flex min-w-0 flex-col gap-3.5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="m-0 text-2xl">{`${a.name}${a.qty > 1 ? ` ×${a.qty}` : ""}`}</h3>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-[13px] text-muted">
                <Badge tone={ASSET_TONE[a.status]}>{ASSET_STATUS[a.status]}</Badge>
                <span>
                  {a.code} · {meta}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {inUse ? <LinkButton href={`/assets/${a.id}/edit`}>Edit</LinkButton> : <UndoDisposal id={a.id} />}
              <LinkButton variant="ghost" href="/assets" aria-label="Close" className="px-2!">
                <XIcon size={18} weight="duotone" />
              </LinkButton>
            </div>
          </div>
          <div className="grid max-w-[460px] grid-cols-[1fr_auto] gap-x-6 gap-y-1.5 text-[15px]">
            <span>Purchase cost</span>
            <span className="text-right">{formatInr(a.cost)}</span>
            <span>Salvage value</span>
            <span className="text-right">{formatInr(a.salvage)}</span>
            <span>Method</span>
            <span className="text-right">{a.method === "SLM" ? `Straight line over ${a.life} years` : `Written-down value at ${Number(a.rate)}% a year`}</span>
            <span>Current charge</span>
            <span className="text-right">{formatInr(a.info.monthDep)} / month</span>
            <span>Accumulated depreciation</span>
            <span className="text-right">{formatInr(a.info.acc)}</span>
            <span className="border-t border-fg pt-2 font-semibold">Net book value</span>
            <span className="border-t border-fg pt-2 text-right font-semibold">{formatInr(a.info.nbv)}</span>
          </div>
          {!inUse && (
            <div className="text-sm text-alert">
              {ASSET_STATUS[a.status]} on {fmtDate(a.disposedOn)}
              {a.status === "SOLD" ? ` for ${formatInr(a.disposedFor ?? 0)}` : ""} · {a.info.gain >= 0 ? "gain" : "loss"} {formatInr(Math.abs(a.info.gain))}
            </div>
          )}
          {(a.notes || a.disposeNote) && <div className="text-sm whitespace-pre-line text-muted">{a.notes || a.disposeNote}</div>}
          <dl className="divide-y divide-line text-sm">
            <Row label="Purchased" value={fmtDate(a.purchaseDate)} />
            {a.accDepCarried > 0 && <Row label="Depreciation before Fitron" value={`${formatInr(a.accDepCarried)} (continues from ${monthLabel(a.depFrom ?? toIso(a.purchaseDate).slice(0, 7))})`} />}
            <Row
              label="Paid"
              value={
                a.purchase ? (
                  <Link href={`/purchases/${a.purchase.id}`} className="text-accent">
                    Purchase {a.purchase.code}
                  </Link>
                ) : a.expense ? (
                  `${a.expense.method} · ${a.expense.code}`
                ) : (
                  "Not from the gym's books"
                )
              }
            />
            <Row label="Supplier" value={a.vendor} />
            <Row label="Bill no." value={a.billNo} />
            <Row label="Serial no." value={a.serial} />
            {u.branchIds.length > 1 && <Row label="Branch" value={a.branch.name} />}
            <Row label="Added" value={fmtStamp(a.createdAt)} />
          </dl>
        </div>
        <div className="flex min-w-0 flex-col gap-10">
          {!inUse && (
            <div className="flex flex-col gap-3.5">
              <h3 className={h3}>{a.status === "SOLD" ? "Sold" : "Scrapped"}</h3>
              <dl className="divide-y divide-line text-sm">
                <Row label="Date" value={fmtDate(a.disposedOn)} />
                {a.status === "SOLD" && <Row label="Received" value={`${formatInr(a.disposedFor ?? 0)}${a.disposeMethod ? ` · ${a.disposeMethod}` : ""}`} />}
                <Row label="Book value then" value={formatInr(a.info.nbv)} />
                <Row label={a.info.gain >= 0 ? "Gain on sale" : "Loss on disposal"} value={<span className={a.info.gain >= 0 ? "text-ok" : "text-alert"}>{formatInr(Math.abs(a.info.gain))}</span>} />
                <Row label="Note" value={a.disposeNote} />
              </dl>
            </div>
          )}
          <div className="flex flex-col gap-3.5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className={h3}>Depreciation schedule</h3>
              <Segmented
                current={mode}
                options={[
                  { key: "year", label: "By financial year", href: `/assets/${a.id}` },
                  { key: "month", label: "By month", href: `/assets/${a.id}?schedule=month` },
                ]}
              />
            </div>
            {rows.length === 0 ? (
              <p className="text-sm text-muted">Depreciation starts in the purchase month.</p>
            ) : (
              <table className={TABLE}>
                <thead>
                  <tr>
                    <th className={TH}>Period</th>
                    <th className={`${TH} text-right`}>Depreciation</th>
                    <th className={`${TH} text-right`}>Closing book value</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {rows.map((r) => (
                    <tr key={r.period}>
                      <td className={TD}>{r.period}</td>
                      <td className={`${TD} text-right`}>{formatInr(r.dep)}</td>
                      <td className={`${TD} text-right`}>{formatInr(r.closing)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          {inUse && (
            <div id="dispose" className="flex flex-col gap-3.5">
              <h3 className={h3}>Sold or scrapped?</h3>
              <DisposeForm id={a.id} today={todayIso()} minDate={toIso(a.purchaseDate)} />
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
