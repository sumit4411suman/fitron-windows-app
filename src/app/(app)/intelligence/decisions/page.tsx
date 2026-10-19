import Link from "next/link";
import { requirePermission } from "@/lib/auth/current";
import { DECISION_CATEGORIES, DECISION_STATUS, listDecisions, type DecisionCategory, type DecisionStatus } from "@/lib/services/decisions";
import { fmtDate, fmtStamp, formatRupees } from "@/lib/format";
import { toIso } from "@/lib/services/time";
import { Badge, Card, Empty, LinkButton, ScrollRegion, TABLE, TD, TH, TR, cx } from "@/components/ui";
import { IntelligenceShell } from "../_ui";

export const metadata = { title: "Decision Simulator · Fitron" };

const TONE: Record<string, "neutral" | "accent" | "alert" | "ok"> = { DRAFT: "neutral", APPROVED: "accent", REJECTED: "alert", DEFERRED: "neutral", IMPLEMENTED: "ok", REVIEWED: "ok" };

export default async function DecisionsPage() {
  const u = await requirePermission("accounting.view");
  const rows = await listDecisions(u);
  return (
    <IntelligenceShell
      u={u}
      current="/intelligence/decisions"
      title="Decision Simulator"
      subtitle="A pricing change, a promotion, a hire, new equipment, longer hours: set the objective and constraints, compare options with the Profit Simulator's figures next to your own scores, approve one with your reasoning, record when it went live, and compare the projection with what the books then showed."
      actions={
        <LinkButton href="/intelligence/decisions/new" variant="primary">
          New decision
        </LinkButton>
      }
    >
      {rows.length === 0 ? (
        <Empty>No decisions yet. Each one keeps its baseline, options, scores, the chosen option and the reasoning, so it can be revisited after the review period.</Empty>
      ) : (
        <Card title="Decisions">
          <ScrollRegion label="Decisions">
            <table className={TABLE}>
              <thead>
                <tr>
                  <th className={TH}>Decision</th>
                  <th className={TH}>Category</th>
                  <th className={TH}>Status</th>
                  <th className={cx(TH, "text-right")}>Options</th>
                  <th className={cx(TH, "text-right")}>Chosen option&apos;s forecast profit</th>
                  <th className={TH}>Implemented</th>
                  <th className={TH}>Updated</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => {
                  const chosen = d.options.find((o) => o.id === d.selectedId);
                  const profit = (chosen?.results as { totals?: { operatingProfit?: number } } | undefined)?.totals?.operatingProfit;
                  return (
                    <tr key={d.id} className={TR}>
                      <td className={TD}>
                        <Link href={`/intelligence/decisions/${d.id}`} className="font-semibold hover:text-accent">
                          {d.title}
                        </Link>
                        <span className="block max-w-[400px] truncate text-xs text-muted">{d.objective}</span>
                      </td>
                      <td className={TD}>{DECISION_CATEGORIES[d.category as DecisionCategory] ?? d.category}</td>
                      <td className={TD}>
                        <Badge tone={TONE[d.status] ?? "neutral"}>{DECISION_STATUS[d.status as DecisionStatus] ?? d.status}</Badge>
                        <span className="block text-xs text-muted">v{d.version}</span>
                      </td>
                      <td className={cx(TD, "text-right")}>{d.options.length}</td>
                      <td className={cx(TD, "text-right tabular-nums")}>{typeof profit === "number" ? formatRupees(profit) : "—"}</td>
                      <td className={cx(TD, "whitespace-nowrap")}>{d.implementedOn ? fmtDate(toIso(d.implementedOn)) : "—"}</td>
                      <td className={cx(TD, "whitespace-nowrap text-muted")}>{fmtStamp(d.updatedAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </ScrollRegion>
        </Card>
      )}
    </IntelligenceShell>
  );
}
