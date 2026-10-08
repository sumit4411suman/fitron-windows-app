import Link from "next/link";
import { FileCsvIcon, MicrosoftExcelLogoIcon, StarIcon } from "@phosphor-icons/react/dist/ssr";
import { requirePermission } from "@/lib/auth/current";
import { db } from "@/lib/db";
import { REPORTS, favKey, reportGroups } from "@/lib/services/reports";
import { monthPeriod } from "@/lib/services/accounting";
import { todayIso } from "@/lib/services/time";
import { AutoFilter } from "@/components/auto-filter";
import { PrintButton } from "@/components/print-button";
import { Input, Select, cx } from "@/components/ui";
import { ReportNav, ReportTable } from "./report-client";
import { toggleFavourite } from "./actions";

export const metadata = { title: "Reports · Fitron" };

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const exp = "flex items-center gap-1.5 px-3.5 py-2 text-[13px] hover:bg-accent-soft";

export default async function ReportsPage({ searchParams }: PageProps<"/reports">) {
  const u = await requirePermission("invoices.view");
  const sp = await searchParams;
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const groups = reportGroups(u);
  const allowed = groups.flatMap((g) => g.items.map((i) => i.key));
  const favRow = await db.setting.findUnique({ where: { orgId_key: { orgId: u.orgId, key: favKey(u.id) } } });
  const favs = (Array.isArray(favRow?.value) ? (favRow.value as string[]) : []).filter((k) => allowed.includes(k));
  const key = allowed.includes(s("r") ?? "") ? s("r")! : (favs[0] ?? allowed[0]!);
  const def = REPORTS[key]!;
  const today = todayIso();
  const period = { from: s("from") && ISO.test(s("from")!) ? s("from")! : monthPeriod(today.slice(0, 7)).from, to: s("to") && ISO.test(s("to")!) ? s("to")! : today };
  const report = await def.run(u, period);
  const qs = def.usesPeriod ? `?from=${period.from}&to=${period.to}` : "";
  const nav = [...(favs.length ? [{ group: "Favourites", items: favs.map((k) => ({ key: k, title: REPORTS[k]!.title })) }] : []), ...groups];
  const href = Object.fromEntries(allowed.map((k) => [k, `/reports?r=${k}`]));
  const branch = u.branch === "ALL" ? "All branches" : (u.branches.find((b) => b.id === u.branch)?.name ?? "");
  const isFav = favs.includes(key);

  return (
    <div className="flex flex-col gap-6">
      <div className="print:hidden">
        <div className="text-xs tracking-[0.04em] text-muted uppercase">Report center</div>
        <h1 className="mt-1 text-[28px] lg:text-[40px]">Reports</h1>
        <div className="mt-1 text-sm text-muted">Every figure comes from invoices, payments and expenses, never typed totals.</div>
      </div>
      <div className="flex items-start gap-6">
        <ReportNav groups={nav} current={key} href={href} />
        <div className="flex min-w-0 flex-1 flex-col gap-3.5">
          <AutoFilter className="lg:hidden print:hidden">
            <Select name="r" defaultValue={key} aria-label="Report">
              {groups.flatMap((g) =>
                g.items.map((i) => (
                  <option key={i.key} value={i.key}>
                    {g.group} · {i.title}
                  </option>
                )),
              )}
            </Select>
          </AutoFilter>
          <section className="overflow-hidden rounded-lg bg-surface">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line px-5 py-[18px]">
              <div className="flex items-start gap-2.5">
                <form action={toggleFavourite.bind(null, key)} className="print:hidden">
                  <button title="Favourite" aria-label={isFav ? "Remove from favourites" : "Add to favourites"} className="grid h-9 w-9 place-items-center rounded-md hover:bg-fg/7">
                    <StarIcon size={20} weight={isFav ? "fill" : "duotone"} className="text-accent" />
                  </button>
                </form>
                <div>
                  <h2 className="text-2xl">{def.title}</h2>
                  <div className="mt-0.5 text-[13px] text-muted">{[def.note, branch].filter(Boolean).join(" · ")}</div>
                </div>
              </div>
              <div className="inline-flex overflow-hidden rounded-md border border-line print:hidden">
                <Link href={`/reports/${key}/csv${qs}`} prefetch={false} className={exp}>
                  <FileCsvIcon size={16} weight="duotone" />
                  CSV
                </Link>
                <Link href={`/reports/${key}/xls${qs}`} prefetch={false} className={cx(exp, "border-l border-line")}>
                  <MicrosoftExcelLogoIcon size={16} weight="duotone" />
                  Excel
                </Link>
                <span className="border-l border-line [&>button]:min-h-0 [&>button]:rounded-none [&>button]:border-0 [&>button]:px-3.5 [&>button]:py-2 [&>button]:text-[13px] [&>button]:font-normal">
                  <PrintButton label="PDF" />
                </span>
              </div>
            </div>
            {def.usesPeriod && (
              <AutoFilter className="flex flex-wrap items-center gap-2.5 border-b border-line px-5 py-3 print:hidden">
                <input type="hidden" name="r" value={key} />
                <span className="text-[13px] text-muted">From</span>
                <Input type="date" name="from" aria-label="From date" defaultValue={period.from} className="w-auto!" />
                <span className="text-[13px] text-muted">to</span>
                <Input type="date" name="to" aria-label="To date" defaultValue={period.to} className="w-auto!" />
              </AutoFilter>
            )}
            <ReportTable key={`${key}|${period.from}|${period.to}`} columns={report.columns} rows={report.rows} totals={report.totals} />
          </section>
        </div>
      </div>
    </div>
  );
}
