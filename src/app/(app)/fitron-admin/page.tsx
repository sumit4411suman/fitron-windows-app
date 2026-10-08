import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/current";
import { isFitronAdmin } from "@/lib/integrations/fitron-team";
import { platformOverview, type Income, type Money } from "@/lib/services/platform-admin";
import { todayIso } from "@/lib/services/time";
import { Card, ScrollRegion, Stat, TABLE, TD, TH, TR } from "@/components/ui";
import { fmtMonthShort, formatRupees } from "@/lib/format";
import { AdminTabs } from "./tabs";

export const metadata = { title: "FITRON admin" };

const SOURCES: [keyof Omit<Income, "all">, string][] = [
  ["plans", "Gym plans"],
  ["branches", "Extra branches"],
  ["services", "Add-ons"],
  ["trainer", "AI Trainer"],
];

/** FITRON team only (FITRON_ADMIN_EMAILS): every gym and person on the product, and what FITRON has been paid. */
export default async function FitronAdminPage() {
  const u = await requireUser();
  if (!isFitronAdmin(u.email)) notFound();
  const o = await platformOverview(todayIso());
  const { thisMonth, lastMonth, all } = o.income;
  const cell = (m: Money) => <td className={`${TD} text-right tabular-nums`}>{formatRupees(m.total)}</td>;

  return (
    <>
      <div className="mb-7 pt-3">
        <h1 className="text-[28px] leading-[1.15] font-semibold lg:text-[40px] lg:leading-[1.1]">FITRON admin</h1>
        <p className="mt-1.5 text-sm text-muted">The whole product at a glance: every gym and person on it, and what FITRON has been paid. Test-server (demo) gyms and payments are left out.</p>
      </div>
      <AdminTabs current="/fitron-admin" />

      <div className="mb-8 grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-5">
        <Stat label={`Income · ${fmtMonthShort(o.month)}`} value={formatRupees(thisMonth.all.total)} />
        <Stat label="Income · last month" value={formatRupees(lastMonth.all.total)} />
        <Stat label="Income · all time" value={formatRupees(all.all.total)} />
        <Stat label="Owed to gyms · this month" value={formatRupees(o.payoutsOwed)} />
        <Stat label="Gyms" value={o.gyms.total} />
        <Stat label="Paying gyms" value={o.gyms.paid} />
        <Stat label="On free trial" value={o.gyms.trial} />
        <Stat label="Plan ended" value={o.gyms.lapsed + o.gyms.grace} tone={o.gyms.lapsed ? "alert" : undefined} />
        <Stat label="New gyms this month" value={o.gyms.newThisMonth} />
        <Stat label="Gym staff logins" value={o.people.staff} />
        <Stat label="Gym members" value={o.people.members} />
        <Stat label="Branches" value={o.people.branches} />
        <Stat label="AI Trainer users" value={o.trainer.total} />
        <Stat label="AI Trainer paying" value={o.trainer.paying} />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Income by source" action={<Link href="/fitron-admin/trainer?tab=payments" className="text-sm underline">AI Trainer payments</Link>}>
          <ScrollRegion label="Income by source">
            <table className={TABLE}>
              <thead>
                <tr>
                  <th className={TH}>Source</th>
                  <th className={`${TH} text-right`}>{fmtMonthShort(o.month)}</th>
                  <th className={`${TH} text-right`}>Last month</th>
                  <th className={`${TH} text-right`}>All time</th>
                </tr>
              </thead>
              <tbody>
                {SOURCES.map(([k, label]) => (
                  <tr key={k} className={TR}>
                    <td className={TD}>{label}</td>
                    {cell(thisMonth[k])}
                    {cell(lastMonth[k])}
                    {cell(all[k])}
                  </tr>
                ))}
                <tr>
                  <td className={`${TD} font-semibold`}>Total, GST included</td>
                  <td className={`${TD} text-right font-semibold tabular-nums`}>{formatRupees(thisMonth.all.total)}</td>
                  <td className={`${TD} text-right font-semibold tabular-nums`}>{formatRupees(lastMonth.all.total)}</td>
                  <td className={`${TD} text-right font-semibold tabular-nums`}>{formatRupees(all.all.total)}</td>
                </tr>
                <tr>
                  <td className={TD}>Before GST</td>
                  <td className={`${TD} text-right tabular-nums`}>{formatRupees(thisMonth.all.base)}</td>
                  <td className={`${TD} text-right tabular-nums`}>{formatRupees(lastMonth.all.base)}</td>
                  <td className={`${TD} text-right tabular-nums`}>{formatRupees(all.all.base)}</td>
                </tr>
              </tbody>
            </table>
          </ScrollRegion>
        </Card>

        <Card title="Last 6 months">
          <ScrollRegion label="Income by month">
            <table className={TABLE}>
              <thead>
                <tr>
                  <th className={TH}>Month</th>
                  <th className={`${TH} text-right`}>Payments</th>
                  <th className={`${TH} text-right`}>Before GST</th>
                  <th className={`${TH} text-right`}>Total</th>
                </tr>
              </thead>
              <tbody>
                {o.income.months.map((m) => (
                  <tr key={m.month} className={TR}>
                    <td className={TD}>
                      {fmtMonthShort(m.month)} {m.month.slice(0, 4)}
                    </td>
                    <td className={`${TD} text-right tabular-nums`}>{m.count}</td>
                    <td className={`${TD} text-right tabular-nums`}>{formatRupees(m.base)}</td>
                    <td className={`${TD} text-right font-semibold tabular-nums`}>{formatRupees(m.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>
        </Card>

        <Card title="Gyms by plan" action={<Link href="/fitron-admin/gyms" className="text-sm underline">All gyms</Link>}>
          <table className={TABLE}>
            <tbody>
              {o.gyms.byPlan.map((p) => (
                <tr key={p.key} className={TR}>
                  <td className={TD}>{p.name}</td>
                  <td className={`${TD} text-right tabular-nums`}>{p.gyms}</td>
                </tr>
              ))}
              {o.gyms.byPlan.length === 0 && (
                <tr>
                  <td className={TD}>No gyms yet.</td>
                </tr>
              )}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-muted">
            {o.gyms.custom} {o.gyms.custom === 1 ? "gym is" : "gyms are"} on a plan FITRON set up by hand, with no trial or payment.
          </p>
        </Card>
      </div>
    </>
  );
}
