import Link from "next/link";
import { DownloadSimpleIcon, MicrosoftExcelLogoIcon, XIcon } from "@phosphor-icons/react/dist/ssr";
import { requirePermission, upgradePath } from "@/lib/auth/current";
import { db } from "@/lib/db";
import { listAudit } from "@/lib/services/accounting";
import { verifyAuditChain } from "@/lib/services/audit";
import { istInstant, todayIso } from "@/lib/services/time";
import { addDays } from "@/lib/domain/dates";
import { AUDIT_MODULES, changedFields, deviceLabel, describeAudit, moduleOf, severityOf, type Severity } from "@/lib/domain/audit";
import { AutoFilter } from "@/components/auto-filter";
import { Button, Input, LinkButton, SEARCH, Segmented, Select, TABLE, TD, TH, TR, cx, ScrollRegion } from "@/components/ui";
import { PrintButton } from "@/components/print-button";
import { Tag } from "@/components/tag";
import { fmtStamp, fmtTime } from "@/lib/format";

export const metadata = { title: "Audit log · Fitron" };

const RANGES = [
  ["today", "Today"],
  ["7", "7 days"],
  ["30", "30 days"],
  ["all", "All time"],
  ["custom", "Custom"],
] as const;
const SEVERITIES = ["High", "Medium", "Low"] as const;

/** Field-by-field differences between the before and after of a change, as "field: old → new". */
const changes = (before: unknown, after: unknown): [string, string][] => changedFields(before, after).map((c) => [c.label, c.text]);

/** Where a record lives in the app, when it has a page. */
const LINKS: Record<string, (id: string) => string> = {
  Member: (id) => `/members/${id}`,
  Invoice: (id) => `/invoices/${id}`,
  Lead: (id) => `/leads/${id}`,
  Purchase: (id) => `/purchases/${id}`,
  Asset: (id) => `/assets/${id}`,
  Product: (id) => `/products/${id}`,
  AutopayMandate: (id) => `/autopay/${id}`,
};

export default async function AuditPage({ searchParams }: PageProps<"/audit">) {
  const u = await requirePermission("audit.view");
  const sp = await searchParams;
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const today = todayIso();
  const range = RANGES.some(([k]) => k === s("range")) ? s("range")! : "30";
  const from = range === "today" ? today : range === "7" ? addDays(today, -6) : range === "30" ? addDays(today, -29) : range === "custom" ? s("from") : undefined;
  const to = range === "custom" ? s("to") : undefined;
  const severity = SEVERITIES.includes(s("sev") as Severity) ? (s("sev") as Severity) : undefined;
  const mod = AUDIT_MODULES.includes(s("mod") ?? "") ? s("mod") : undefined;
  const page = Number(s("page") ?? 1) || 1;
  const [list, all, todays, highInView, chain] = await Promise.all([
    listAudit(u, { q: s("q"), userId: s("user"), module: mod, severity, from, to, page, pageSize: 25 }),
    db.auditLog.count({ where: { orgId: u.orgId } }),
    db.auditLog.findMany({ where: { orgId: u.orgId, createdAt: { gte: istInstant(today, "00:00") } }, select: { userId: true } }),
    severity && severity !== "High" ? Promise.resolve(null) : listAudit(u, { q: s("q"), userId: s("user"), module: mod, severity: "High", from, to, pageSize: 1 }),
    verifyAuditChain(u.orgId),
  ]);
  const rows = list.rows;
  const pages = Math.max(1, Math.ceil(list.total / list.pageSize));
  const link = (p: Record<string, string | undefined>) => {
    const keep = { range: range === "30" ? undefined : range, from: s("from"), to: s("to"), sev: severity, mod, user: s("user"), q: s("q"), ...p };
    const qs = new URLSearchParams(Object.entries(keep).filter(([, v]) => v) as [string, string][]).toString();
    return `/audit${qs ? `?${qs}` : ""}`;
  };
  const sel = s("sel") ? await db.auditLog.findFirst({ where: { orgId: u.orgId, id: BigInt(/^\d+$/.test(s("sel")!) ? s("sel")! : "0") } }) : null;
  const selUser = sel?.userId ? list.users.find((x) => x.id === sel.userId) : null;
  const selBranch = sel?.branchId ? ((await db.branch.findFirst({ where: { orgId: u.orgId, id: sel.branchId }, select: { name: true } }))?.name ?? "Deleted branch") : "All branches";
  const payCode = sel?.entity === "Payment" && typeof (sel.after as { code?: unknown } | null)?.code === "string" ? (sel.after as { code: string }).code : "";
  const selSentence = sel ? describeAudit({ action: sel.action, entity: sel.entity, entityId: sel.entityId, before: sel.before, after: sel.after, extra: { branchName: selBranch === "All branches" ? undefined : selBranch } }) : "";
  const exportQs = new URLSearchParams(Object.entries({ range, from: s("from"), to: s("to"), sev: severity, mod, user: s("user"), q: s("q") }).filter(([, v]) => v) as [string, string][]).toString();
  const kpis: [string, string, string][] = [
    ["Entries today", todays.length.toLocaleString("en-IN"), todays.length ? `${new Set(todays.map((t) => t.userId)).size} ${new Set(todays.map((t) => t.userId)).size === 1 ? "user" : "users"} active` : "No activity yet"],
    ["High-severity in view", highInView ? highInView.total.toLocaleString("en-IN") : "0", "reversals, deletions, unlocks, role changes"],
    ["Integrity", chain.bad ? `${chain.bad} broken` : "Verified", chain.checked ? `hash chain over ${chain.checked.toLocaleString("en-IN")} entries` : "hash chain starts with the next entry"],
    ["Retention", "7 years", "append-only; nothing can be edited or deleted"],
  ];

  return (
    <div className="flex flex-col gap-6 pt-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-[11px] tracking-[0.1em] text-muted uppercase">
            Append-only · {all.toLocaleString("en-IN")} entries · {list.total.toLocaleString("en-IN")} in view
          </div>
          <h1 className="mt-1 text-[28px] lg:text-[40px]">Audit log</h1>
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
          <PrintButton />
          {u.has("exports") ? (
            <LinkButton href={`/audit/xls?${exportQs}`} prefetch={false}>
              <MicrosoftExcelLogoIcon size={16} weight="duotone" />
              Excel
            </LinkButton>
          ) : (
            <LinkButton href={upgradePath(u, "exports")} title="Professional plan">
              <MicrosoftExcelLogoIcon size={16} weight="duotone" />
              Excel
            </LinkButton>
          )}
          <LinkButton href={`/audit/csv?${exportQs}`} prefetch={false}>
            <DownloadSimpleIcon size={16} weight="duotone" />
            CSV
          </LinkButton>
        </div>
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,200px),1fr))] gap-x-10 gap-y-6">
        {kpis.map(([k, v, sub]) => (
          <div key={k}>
            <div className="text-xs tracking-[0.06em] text-muted uppercase">{k}</div>
            <div className={cx("mt-1 text-[28px] leading-[1.15] font-semibold", k === "Integrity" && chain.bad > 0 && "text-alert-700")}>{v}</div>
            <div className="mt-0.5 text-[13px] text-muted">{sub}</div>
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-2.5 print:hidden">
        <div className="flex flex-wrap items-center gap-2.5">
          <Segmented options={RANGES.map(([k, label]) => ({ key: k, label, href: link({ range: k === "30" ? undefined : k, page: undefined }) }))} current={range} />
          {range === "custom" && (
            <AutoFilter className="flex gap-2">
              <input type="hidden" name="range" value="custom" />
              <Input type="date" name="from" defaultValue={s("from")} max={today} aria-label="From" className="w-auto!" />
              <Input type="date" name="to" defaultValue={s("to")} max={today} aria-label="To" className="w-auto!" />
            </AutoFilter>
          )}
          <Segmented options={[{ key: "", label: "All", href: link({ sev: undefined, page: undefined }) }, ...SEVERITIES.map((v) => ({ key: v, label: v, href: link({ sev: v, page: undefined }) }))]} current={severity ?? ""} />
        </div>
        <AutoFilter className="flex flex-wrap items-center gap-2.5">
          {range !== "30" && <input type="hidden" name="range" value={range} />}
          {range === "custom" && (
            <>
              <input type="hidden" name="from" value={s("from") ?? ""} />
              <input type="hidden" name="to" value={s("to") ?? ""} />
            </>
          )}
          {severity && <input type="hidden" name="sev" value={severity} />}
          <input type="text" name="q" defaultValue={s("q")} placeholder="Search actions, IDs, users" aria-label="Search" className={SEARCH} />
          <Select name="user" defaultValue={s("user") ?? ""} aria-label="User" className="w-auto!">
            <option value="">All users</option>
            {list.hasSystem && <option value="system">System</option>}
            {list.users.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </Select>
          <Select name="mod" defaultValue={mod ?? ""} aria-label="Module" className="w-auto!">
            <option value="">All modules</option>
            {AUDIT_MODULES.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </Select>
          <Link href="/audit" className="text-[13px] font-semibold text-accent">
            Clear filters
          </Link>
        </AutoFilter>
      </div>

      {sel && (
        <section className="flex flex-col gap-3 rounded-lg border border-line bg-surface px-5 py-[18px]">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[11px] tracking-[0.1em] text-muted uppercase">Entry {String(sel.id)}</div>
              <div className="mt-1 text-lg font-semibold">
                {selSentence}
              </div>
            </div>
            <Link href={link({ page: s("page") })} aria-label="Close" className="grid size-9 place-items-center rounded-md text-accent hover:bg-accent/10">
              <XIcon size={18} weight="duotone" />
            </Link>
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,240px),1fr))] gap-x-6 gap-y-2">
            {(
              [
                ["Timestamp", `${fmtStamp(sel.createdAt)}, ${fmtTime(sel.createdAt)}`],
                ["User", selUser ? `${selUser.name} · ${selUser.role.name}` : "System · Automatic"],
                ["Branch", selBranch],
                ["Module", moduleOf(sel.entity, sel.action)],
                ["Severity", severityOf(sel.action, sel.entity)],
                ["Device / IP", deviceLabel(sel.userAgent, sel.ip, sel.actorType)],
                ["Entry hash", sel.hash ?? "— (before hashing was enabled)"],
                ["Previous hash", sel.prevHash ?? "—"],
                ["Record", `${sel.entity} ${sel.entityId}`],
                ...changes(sel.before, sel.after).slice(0, 20),
              ] as [string, string][]
            ).map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3 border-b border-line-soft py-[5px] text-sm">
                <span className="text-muted">{k}</span>
                <span className="text-right break-all">{v}</span>
              </div>
            ))}
          </div>
          {(LINKS[sel.entity] || payCode) && (
            <div>
              <LinkButton href={LINKS[sel.entity] ? LINKS[sel.entity]!(sel.entityId) : `/payments?q=${encodeURIComponent(payCode)}`}>{LINKS[sel.entity] ? `Open ${sel.entity.toLowerCase()}` : "Open payments"}</LinkButton>
            </div>
          )}
        </section>
      )}

      {rows.length === 0 ? (
        <p className="text-sm text-muted">No entries match these filters.</p>
      ) : (
        <ScrollRegion label="Audit table">
          <table className={cx(TABLE, "min-w-[860px]")}>
            <thead>
              <tr>
                {["Date", "Time", "User", "Module", "Action", "Severity", "Device"].map((h) => (
                  <th key={h} className={TH}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const sev = r.severity;
                return (
                  <tr key={r.id} className={cx(TR, sel && String(sel.id) === r.id && "bg-accent-soft")}>
                    <td className={cx(TD, "whitespace-nowrap")}>
                      <Link href={link({ sel: r.id, page: s("page") })} className="hover:text-accent">
                        {fmtStamp(r.createdAt)}
                      </Link>
                    </td>
                    <td className={cx(TD, "whitespace-nowrap")}>{fmtTime(r.createdAt)}</td>
                    <td className={cx(TD, "whitespace-nowrap")}>
                      <div>{r.userName}</div>
                      <div className="text-xs text-muted">{r.roleName}</div>
                    </td>
                    <td className={cx(TD, "whitespace-nowrap")}>{r.module}</td>
                    <td className={TD}>
                      <Link href={link({ sel: r.id, page: s("page") })} className="hover:text-accent">
                        {r.sentence}
                      </Link>
                    </td>
                    <td className={TD}>
                      <Tag label={sev} style={sev === "High" ? 3 : sev === "Medium" ? 0 : "neutral"} />
                    </td>
                    <td className={cx(TD, "text-xs whitespace-nowrap text-muted")}>{r.device}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </ScrollRegion>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <span className="text-[13px] text-muted">
          Page {list.page} of {pages}
        </span>
        <div className="flex gap-2">
          {list.page > 1 ? <LinkButton href={link({ page: String(list.page - 1) })}>Previous</LinkButton> : <Button disabled>Previous</Button>}
          {list.page < pages ? <LinkButton href={link({ page: String(list.page + 1) })}>Next</LinkButton> : <Button disabled>Next</Button>}
        </div>
      </div>
      <p className="m-0 max-w-[720px] text-[13px] leading-relaxed text-muted">Every write to members, money, settings and roles is recorded with who, when, from which device and branch. Entries are chained by hash so any tampering shows up in the Integrity check. Kept for 7 years; nobody, including the Super Admin, can edit or delete an entry.</p>
    </div>
  );
}
