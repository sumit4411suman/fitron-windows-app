import Link from "next/link";
import { PlusIcon, TicketIcon } from "@phosphor-icons/react/dist/ssr";
import { requirePermission } from "@/lib/auth/current";
import { db } from "@/lib/db";
import { listPlans } from "@/lib/services/plans";
import { listOffers } from "@/lib/services/offers";
import { getTax } from "@/lib/services/tax";
import { fromIso, todayIso, toIso } from "@/lib/services/time";
import { offerState } from "@/lib/domain/offers";
import { ConfirmButton } from "@/components/confirm-button";
import { Tag } from "@/components/tag";
import { LinkButton, ListHeader, Notice, TABLE, TD, TH, TR, cx, ScrollRegion } from "@/components/ui";
import { fmtDate, formatRupees } from "@/lib/format";
import { changePlanStatus, removePlan, toggleOffer } from "./actions";

export const metadata = { title: "Plans & offers · Fitron" };

const ghost = "inline-flex py-2.5 leading-[1.2] items-center rounded-md px-1.5 text-sm font-semibold text-accent hover:bg-accent/10";

export default async function PlansPage({ searchParams }: PageProps<"/plans">) {
  const u = await requirePermission("plans.manage");
  const { error } = await searchParams;
  const today = todayIso();
  const [plans, offers, tax, current] = await Promise.all([
    listPlans(u),
    listOffers(u),
    getTax(u.orgId),
    // Active members per plan: memberships covering today.
    db.membership.findMany({
      where: { status: "VALID", startDate: { lte: fromIso(today) }, endDate: { gte: fromIso(today) }, member: { orgId: u.orgId, deletedAt: null } },
      select: { planId: true, memberId: true },
      distinct: ["memberId", "planId"],
    }),
  ]);
  const activeOn = (id: string) => new Set(current.filter((m) => m.planId === id).map((m) => m.memberId)).size;

  return (
    <div className="flex flex-col gap-6 pt-4">
      <ListHeader
        kicker={`${plans.filter((p) => p.status === "ACTIVE").length} active plans`}
        title="Plans & offers"
        actions={
          <>
            <LinkButton href="/plans/offers/new">
              <TicketIcon size={17} weight="duotone" />
              New offer code
            </LinkButton>
            <LinkButton href="/plans/new" variant="primary">
              <PlusIcon size={17} weight="duotone" />
              New plan
            </LinkButton>
          </>
        }
      />
      {typeof error === "string" && <Notice tone="alert">{error}</Notice>}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,280px),1fr))] gap-5">
        {plans.map((p) => (
          <div key={p.id} className={cx("flex flex-col gap-2.5 rounded-md border bg-surface p-[15px]", p.status === "ACTIVE" ? "border-transparent" : "border-dashed border-line")}>
            <div className="flex items-center justify-between">
              <div className={cx("text-[10px] tracking-[0.1em] uppercase", p.status === "ACTIVE" ? "text-accent" : "text-muted")}>{p.months === 1 ? "1 month" : `${p.months} months`}</div>
              <Tag label={p.status === "ACTIVE" ? "Active" : "Inactive"} />
            </div>
            <div className={cx("text-[22px] leading-tight font-semibold", p.status !== "ACTIVE" && "text-muted")}>{p.name}</div>
            <div className={cx("text-[28px] font-semibold", p.status !== "ACTIVE" && "text-muted")}>{formatRupees(p.price)}</div>
            <div className="text-[13px] text-muted">
              {p.regFee ? `+ ${formatRupees(p.regFee)} registration` : "No registration fee"}
              {tax.enabled && p.gstApplicable ? ` · + GST ${tax.rate}%` : ""} · {formatRupees(Math.round(p.price / p.months))}/month
            </div>
            {p.description && <p className="m-0 flex-1 text-[13px] opacity-80">{p.description}</p>}
            {p.features.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {p.features.map((f) => (
                  <Tag key={f} label={f} />
                ))}
              </div>
            )}
            <div className="text-[13px] text-muted">{p.prices.length ? `Pricing: ${p.prices.map((x) => `${x.category} ${formatRupees(x.price)}`).join(" · ")}` : "Single price"}</div>
            <div className="flex flex-wrap items-center justify-between gap-1.5 text-[11px] text-fg/50">
              <span>{activeOn(p.id)} active members</span>
              <span className="flex gap-0.5">
                <Link href={`/plans/${p.id}/edit`} className={ghost}>
                  Edit
                </Link>
                <form action={changePlanStatus.bind(null, p.id, p.status === "ACTIVE" ? "INACTIVE" : "ACTIVE")}>
                  <button className={ghost}>{p.status === "ACTIVE" ? "Deactivate" : "Activate"}</button>
                </form>
                {p._count.memberships === 0 && (
                  <form action={removePlan.bind(null, p.id)}>
                    <ConfirmButton variant="ghost" className="text-alert-700" confirm={`Delete plan ${p.name}? This plan has never been sold, so it can be removed.`}>
                      Delete
                    </ConfirmButton>
                  </form>
                )}
              </span>
            </div>
          </div>
        ))}
      </div>
      {plans.length === 0 && <p className="text-muted">No plans yet. Create the plans you sell, like Monthly, Quarterly and Annual.</p>}
      <p className="text-[13px] text-muted">Plans used in any membership or invoice can’t be deleted. Deactivate them instead; history stays intact.</p>

      <section id="offers" className="mt-4 flex scroll-mt-24 flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="m-0 text-[28px]">Offers &amp; promo codes</h2>
            <div className="text-[13px] text-muted">Apply at registration or renewal. Each use is tracked.</div>
          </div>
          <LinkButton href="/plans/offers/new">
            <PlusIcon weight="duotone" />
            New offer
          </LinkButton>
        </div>
        {offers.length ? (
          <ScrollRegion label="Plans table">
            <table className={TABLE}>
              <thead>
                <tr>
                  {["Code", "Description", "Discount", "Valid till", "Uses", "Status", ""].map((h, i) => (
                    <th key={i} className={TH}>
                      {h || <span className="sr-only">Actions</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {offers.map((o) => {
                  const st = offerState({ ...o, validTill: toIso(o.validTill) }, today);
                  return (
                    <tr key={o.id} className={TR}>
                      <td className={cx(TD, "font-semibold tracking-[0.04em]")}>{o.code}</td>
                      <td className={TD}>{o.description}</td>
                      <td className={TD}>{o.type === "PERCENT" ? `${o.value}%` : formatRupees(o.value)}</td>
                      <td className={cx(TD, "whitespace-nowrap")}>{fmtDate(o.validTill)}</td>
                      <td className={TD}>
                        {o.uses}
                        {o.usageLimit ? ` / ${o.usageLimit}` : ""}
                      </td>
                      <td className={TD}>
                        <Tag label={st}>{st}</Tag>
                      </td>
                      <td className={TD}>
                        <form action={toggleOffer.bind(null, o.id, o.status === "ACTIVE" ? "PAUSED" : "ACTIVE")}>
                          <button className={ghost}>{o.status === "ACTIVE" ? "Pause" : "Activate"}</button>
                        </form>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </ScrollRegion>
        ) : null}
        <section className="flex flex-col gap-2">
          <h3 className="m-0 text-[20px]">Offer codes</h3>
          {offers.map((o) => {
            const st = offerState({ ...o, validTill: toIso(o.validTill) }, today);
            return (
              <div key={o.id} className="flex items-center justify-between gap-3 border-b border-line py-2.5">
                <span className="font-semibold tracking-[0.06em]">{o.code}</span>
                <Tag label={st}>{st}</Tag>
              </div>
            );
          })}
          {!offers.length && <p className="m-0 text-sm text-muted">No offer codes yet. Create one for festivals, referrals or students.</p>}
        </section>
      </section>
    </div>
  );
}
