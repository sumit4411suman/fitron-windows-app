import Link from "next/link";
import { requirePermission, type CurrentUser } from "@/lib/auth/current";
import { canOpen } from "@/lib/nav";
import { RECOMMENDATION_STATUS_LABEL, type Evidence } from "@/lib/domain/growth";
import { explainRecommendation, growthPeriods, listRecommendations, recommendationHistory, type RecommendationRow } from "@/lib/services/growth";
import { getAiSettings } from "@/lib/services/ai-settings";
import { todayIso } from "@/lib/services/time";
import { fmtDate, fmtStamp, formatRupees } from "@/lib/format";
import { Badge, Empty, LinkButton, Notice, ScrollRegion, TABLE, TD, TH, TR, cx } from "@/components/ui";
import { ActionButton } from "@/components/action-form";
import { IntelligenceShell, KindBadge, Level, fmtValue } from "./_ui";
import { RecommendationActions } from "./rec-actions";
import { refreshGrowth } from "./actions";

export const metadata = { title: "Growth Engine · Fitron" };

export default async function GrowthPage({ searchParams }: PageProps<"/intelligence">) {
  const u = await requirePermission("accounting.view");
  const sp = await searchParams;
  const view = sp.view === "history" ? "history" : "open";
  const today = todayIso();
  const { period, previous } = growthPeriods(today);
  const [open, history, ai] = await Promise.all([listRecommendations(u, "open"), recommendationHistory(u), getAiSettings(u.orgId)]);
  const canAsk = u.can("ai.use") && ai.enabled && canOpen(u, "/ai");
  // The model's wording, when on and grounded; the rule's own text otherwise. At most the top three to keep it quick.
  const worded = new Map<string, string>();
  if (view === "open") for (const r of open.slice(0, 3)) {
    const t = await explainRecommendation(u, r);
    if (t) worded.set(r.id, t);
  }

  return (
    <IntelligenceShell
      u={u}
      current="/intelligence"
      title="Growth Engine"
      subtitle={`Recommendations built from last month's verified figures (${period.label} against ${previous.label}): each one shows its evidence, whether a figure is an actual or an estimate, and what to do next. Nothing is acted on without you.`}
      actions={
        <>
          <ActionButton action={refreshGrowth} label="Refresh from the books" />
          {canAsk && (
            <LinkButton href="/ai" variant="ghost">
              Ask Fitron AI about these figures
            </LinkButton>
          )}
        </>
      }
    >
      <div className="flex flex-wrap items-center gap-3 text-[13px] text-muted">
        <Link href="/intelligence" className={cx("rounded-md px-3 py-1.5", view === "open" ? "bg-accent-soft text-accent-strong" : "hover:bg-fg/7")}>
          Open ({open.length})
        </Link>
        <Link href="/intelligence?view=history" className={cx("rounded-md px-3 py-1.5", view === "history" ? "bg-accent-soft text-accent-strong" : "hover:bg-fg/7")}>
          History ({history.rows.length})
        </Link>
        <span>
          Accepted {history.tally.accepted} · completed {history.tally.completed} · dismissed {history.tally.dismissed} · deferred {history.tally.deferred}
        </span>
      </div>

      {view === "open" && open.length === 0 && (
        <Empty>
          Nothing to recommend from {period.label}&apos;s figures. The engine only speaks when a rule finds a measurable change with enough data behind it (at least ten membership endings for a renewal trend, ₹5,000 of eligible dues, a cost group over ₹5,000 that grew faster than revenue). Press <strong>Refresh from the books</strong> after the month closes, or once more records are in.
        </Empty>
      )}

      {view === "open" && open.map((r) => <Card key={r.id} r={r} u={u} worded={worded.get(r.id)} />)}

      {view === "history" && (
        <ScrollRegion label="Recommendation history">
          <table className={TABLE}>
            <thead>
              <tr>
                <th className={TH}>Recommendation</th>
                <th className={TH}>Period</th>
                <th className={TH}>Decision</th>
                <th className={TH}>Note</th>
                <th className={TH}>Outcome</th>
              </tr>
            </thead>
            <tbody>
              {history.rows.map((r) => {
                const o = r.outcome as { rows?: { label: string; then: number | null; now: number | null; unit: Evidence["unit"] }[] } | null;
                return (
                  <tr key={r.id} className={TR}>
                    <td className={TD}>{r.title}</td>
                    <td className={cx(TD, "whitespace-nowrap")}>{fmtDate(r.periodFrom)} – {fmtDate(r.periodTo)}</td>
                    <td className={cx(TD, "whitespace-nowrap")}>
                      <Badge tone={r.status === "COMPLETED" ? "ok" : r.status === "DISMISSED" ? "neutral" : "accent"}>{RECOMMENDATION_STATUS_LABEL[r.status as keyof typeof RECOMMENDATION_STATUS_LABEL] ?? r.status}</Badge>
                      <span className="block text-xs text-muted">{fmtStamp(r.decidedAt)}</span>
                    </td>
                    <td className={TD}>{r.outcomeNote ?? "—"}</td>
                    <td className={TD}>
                      {o?.rows?.length ? (
                        <ul className="m-0 list-none p-0 text-xs">
                          {o.rows.map((x) => (
                            <li key={x.label}>
                              {x.label}: {fmtValue(x.then, x.unit)} → {fmtValue(x.now, x.unit)}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                );
              })}
              {history.rows.length === 0 && (
                <tr>
                  <td className={cx(TD, "text-muted")} colSpan={5}>
                    No decisions yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </ScrollRegion>
      )}
    </IntelligenceShell>
  );
}

function Card({ r, u, worded }: { r: RecommendationRow; u: CurrentUser; worded?: string }) {
  const evidence = (Array.isArray(r.evidence) ? r.evidence : []) as Evidence[];
  return (
    <article className="flex flex-col gap-3 rounded-lg border border-line bg-surface px-[22px] py-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[17px] font-semibold">{r.title}</h2>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[12px] text-muted">
            <span>Urgency</span> <Level level={r.urgency} /> <span>Effort</span> <Level level={r.effort} /> <span>Confidence</span> <Level level={r.confidence} />
            {r.status !== "OPEN" && <Badge tone="accent">{RECOMMENDATION_STATUS_LABEL[r.status as keyof typeof RECOMMENDATION_STATUS_LABEL]}</Badge>}
            {r.deferredUntil && <span>until {fmtDate(r.deferredUntil)}</span>}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[11px] tracking-[0.08em] text-muted uppercase">Estimated impact</div>
          <div className="text-[22px] font-semibold tabular-nums">{r.impactPaise === null ? "Not stated" : formatRupees(r.impactPaise)}</div>
          {r.impactNote && <div className="max-w-[260px] text-[12px] text-muted">{r.impactNote}</div>}
        </div>
      </div>
      <p className="m-0 text-sm">{worded ?? r.body}</p>
      {worded && <p className="m-0 text-[12px] text-muted">Worded by Fitron AI from the figures below; the figures themselves come from the rules.</p>}
      <div className="grid gap-3 md:grid-cols-[1fr_auto]">
        <ScrollRegion label="Evidence">
          <table className={TABLE}>
            <thead>
              <tr>
                <th className={TH}>Evidence</th>
                <th className={cx(TH, "text-right")}>Value</th>
                <th className={cx(TH, "text-right")}>Previous</th>
                <th className={TH}>Period</th>
                <th className={TH}>Kind</th>
              </tr>
            </thead>
            <tbody>
              {evidence.map((e) => (
                <tr key={e.metric} className={TR}>
                  <td className={TD}>{e.label}</td>
                  <td className={cx(TD, "text-right tabular-nums")}>{fmtValue(e.value, e.unit)}</td>
                  <td className={cx(TD, "text-right tabular-nums text-muted")}>{e.previous === undefined ? "—" : fmtValue(e.previous, e.unit)}</td>
                  <td className={cx(TD, "whitespace-nowrap")}>{e.period}</td>
                  <td className={TD}>
                    <KindBadge kind={e.kind} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollRegion>
        <div className="flex flex-col gap-2">
          <Notice tone="neutral">
            <strong>Next:</strong> {r.action}
          </Notice>
          {r.link && canOpen(u, r.link) && (
            <LinkButton href={r.link} variant="default">
              Open
            </LinkButton>
          )}
        </div>
      </div>
      <RecommendationActions id={r.id} status={r.status} canAct={u.can("accounting.view")} />
    </article>
  );
}
