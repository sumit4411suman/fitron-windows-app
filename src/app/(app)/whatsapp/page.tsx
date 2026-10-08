import Link from "next/link";
import { after } from "next/server";
import { EyeIcon, LightningIcon, PaperPlaneTiltIcon, SlidersHorizontalIcon } from "@phosphor-icons/react/dist/ssr";
import { requirePermission } from "@/lib/auth/current";
import { db } from "@/lib/db";
import { getWaSettings, listMessages, listTemplates, templateRule } from "@/lib/services/whatsapp";
import { automationPreview, dispatchScheduled, lastAutomationRun, previewTemplate, ruleSentence } from "@/lib/services/wa-automation";
import { VARS, runLine } from "@/lib/domain/whatsapp";
import { isScheduled } from "@/lib/domain/wa-rules";
import { todayIso } from "@/lib/services/time";
import { Tag } from "@/components/tag";
import { Dialog } from "@/components/dialog";
import { LinkButton, ListHeader, Notice, Pager, TABLE, TD, TH, cx, ScrollRegion } from "@/components/ui";
import { fmtClock, fmtShort, fmtTime } from "@/lib/format";
import { RuleForm, TemplateCard } from "./wa-forms";
import { refreshAction, retryMessageAction, runAutomationAction, runRuleAction, toggleAutoSendAction } from "./actions";
import { log } from "@/lib/log";

export const metadata = { title: "WhatsApp · Fitron" };

const MODE = { demo: "Simulated", cloud: "Cloud API · automatic", connector: "Linked · automatic" } as const;
const PROVIDER = { demo: "Demo mode · messages are logged, not sent", cloud: "WhatsApp Cloud API", connector: "Linked gym phone" } as const;
const FILTERS = ["All", "Read", "Delivered", "Sent", "Failed"] as const;
/** Messages that aren't a member template: the connector test from Settings and FITRON's own notices. */
const OTHER_NAMES: Record<string, string> = { test: "Connector test" };

export default async function WhatsAppPage({ searchParams }: PageProps<"/whatsapp">) {
  const u = await requirePermission("whatsapp.send");
  const sp = await searchParams;
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const tab = s("tab") === "log" ? "log" : "templates";
  const canSettings = u.can("settings.manage");
  const today = todayIso();
  const monthStart = new Date(`${today.slice(0, 7)}-01T00:00:00+05:30`);
  const scope = { orgId: u.orgId, OR: [{ memberId: null }, { member: { branchId: { in: u.branchIds } } }] };
  // Messages held by quiet hours or a rule's send time go out once the page has rendered.
  after(() => dispatchScheduled(u.orgId).catch((e) => log.error("whatsapp.dispatch_failed", e)));
  const [settings, templates, month] = await Promise.all([
    getWaSettings(u.orgId),
    listTemplates(u.orgId),
    db.whatsAppMessage.groupBy({ by: ["status"], where: { ...scope, sentAt: { gte: monthStart } }, _count: { _all: true } }),
  ]);
  const n = (st: string[]) => month.filter((m) => st.includes(m.status)).reduce((a, m) => a + m._count._all, 0);
  const total = month.reduce((a, m) => a + m._count._all, 0);
  const stats: [string, string, boolean?][] = [
    ["Sent this month", String(total)],
    ["Mode", MODE[settings.mode]],
    ...(settings.mode === "demo"
      ? []
      : ([
          ["Delivered", total ? `${Math.round((n(["Delivered", "Read"]) / total) * 100)}%` : "—"],
          ["Read", total ? `${Math.round((n(["Read"]) / total) * 100)}%` : "—"],
        ] as [string, string][])),
    ["Failed", String(n(["Failed"])), true],
  ];
  const ruleKey = canSettings ? s("rule") : undefined;
  const previewKey = canSettings ? s("preview") : undefined;

  return (
    <div className="flex flex-col gap-6">
      <ListHeader
        kicker={`${PROVIDER[settings.mode]}${settings.mode === "connector" && settings.linked?.number ? ` · ${settings.linked.number}` : ""}`}
        title="WhatsApp"
        actions={
          <>
            {settings.mode === "connector" && (
              <form action={refreshAction}>
                <button className="inline-flex py-2.5 leading-[1.2] items-center rounded-md border border-line px-[18px] text-sm font-semibold hover:bg-fg/7">Refresh statuses</button>
              </form>
            )}
            <LinkButton href="/whatsapp/send" variant="primary">
              <PaperPlaneTiltIcon size={17} weight="duotone" />
              New campaign
            </LinkButton>
          </>
        }
      />
      <div className="flex flex-wrap gap-10">
        {stats.map(([k, v, bad]) => (
          <div key={k}>
            <div className="text-[11px] tracking-[0.08em] text-muted uppercase">{k}</div>
            <div className={cx("text-[26px] font-semibold", bad && v !== "0" && "text-alert-700")}>{v}</div>
          </div>
        ))}
      </div>
      <nav aria-label="WhatsApp sections" className="flex flex-wrap gap-1">
        {[
          ["templates", "Templates & automation", "/whatsapp"],
          ["log", "Message log", "/whatsapp?tab=log"],
        ].map(([k, label, href]) => (
          <Link key={k} href={href!} className={cx("border-b-2 px-3 py-2 text-[15px]", k === tab ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg")}>
            {label}
          </Link>
        ))}
      </nav>
      {s("msg") && <Notice tone="ok">{s("msg")}</Notice>}
      {s("err") && !previewKey && <Notice tone="alert">{s("err")}</Notice>}
      {tab === "templates" ? <Templates u={u} templates={templates} settings={settings} canSettings={canSettings} /> : <Log u={u} s={s} templates={templates} />}
      {ruleKey && <RuleDialog u={u} templates={templates} settings={settings} tkey={ruleKey} />}
      {previewKey && <PreviewDialog u={u} tkey={previewKey} error={s("err")} />}
    </div>
  );
}

type U = Awaited<ReturnType<typeof requirePermission>>;
type Templates = Awaited<ReturnType<typeof listTemplates>>;
type Settings = Awaited<ReturnType<typeof getWaSettings>>;

async function Templates({ u, templates, settings, canSettings }: { u: U; templates: Templates; settings: Settings; canSettings: boolean }) {
  const [rows, last, sent, plans] = await Promise.all([
    automationPreview(u),
    lastAutomationRun(u.orgId),
    db.whatsAppMessage.groupBy({ by: ["templateKey"], where: { orgId: u.orgId, OR: [{ memberId: null }, { member: { branchId: { in: u.branchIds } } }] }, _count: { _all: true } }),
    db.membershipPlan.findMany({ where: { orgId: u.orgId }, select: { id: true, name: true } }),
  ]);
  const planNames = new Map(plans.map((p) => [p.id, p.name]));
  const due = rows.reduce((a, r) => a + r.send.length, 0);
  const counts = new Map(sent.map((x) => [x.templateKey, x._count._all]));
  const match = new Map(rows.map((r) => [r.key, `${r.send.length} due today${r.skipped.length ? ` · ${r.skipped.length} skipped` : ""}`]));
  const quiet = `Quiet hours ${fmtClock(settings.quietFrom)} – ${fmtClock(settings.quietTo)}`;
  return (
    <>
      <section className="flex flex-col gap-2.5 rounded-lg bg-surface px-5 py-[18px]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-[17px]">Today&apos;s automation</h3>
            <div className="text-xs text-muted">
              {last.at ? `Last run ${fmtShort(last.at)}, ${fmtTime(last.at)}` : "Not run today"} · {quiet}
            </div>
          </div>
          {canSettings && (
            <form action={runAutomationAction}>
              <button disabled={!due} className="inline-flex py-2.5 leading-[1.2] items-center gap-1.5 rounded-md bg-accent px-[18px] text-sm font-semibold text-accent-ink hover:bg-accent-hover disabled:opacity-45">
                <LightningIcon size={16} weight="duotone" />
                Send {due} due now
              </button>
            </form>
          )}
        </div>
        {rows.map((r) => (
          <div key={r.key} className="flex justify-between gap-3 border-b border-line py-1.5 text-sm">
            <span>
              {r.name} <span className="text-xs text-muted">· {r.time}</span>
            </span>
            <span>
              <strong>{r.send.length}</strong> to send{r.skipped.length > 0 && <span className="text-muted"> · {r.skipped.length} skipped</span>}
            </span>
          </div>
        ))}
        {!rows.length && <div className="text-sm text-muted">Nothing due today from scheduled rules.</div>}
        {last.runs
          .slice(0, 6)
          .map((x, i) => (
            <div key={`${x.ts}-${x.key}-${i}`} className="text-xs text-muted">
              {runLine(x, (ts) => `${fmtShort(new Date(ts))}, ${fmtTime(new Date(ts))}`)}
            </div>
          ))}
      </section>
      <div className="grid gap-5 [grid-template-columns:repeat(auto-fill,minmax(min(100%,340px),1fr))]">
        {templates.map((t) => (
          <TemplateCard
            key={t.key}
            t={{ key: t.key, name: t.name, trigger: t.trigger, body: t.body, autoSend: t.autoSend, metaTemplateName: t.metaTemplateName, language: t.language, rule: ruleSentence(t, settings, planNames), due: match.get(t.key), sent: counts.get(t.key) ?? 0 }}
            vars={[...VARS]}
            canEdit={canSettings}
            cloud={settings.mode === "cloud"}
            toggle={toggleAutoSendAction.bind(null, t.key)}
            actions={
              canSettings && (
                <div key="actions" className="flex flex-wrap gap-1">
                  <LinkButton href={`/whatsapp?rule=${t.key}`} variant="ghost" scroll={false}>
                    <SlidersHorizontalIcon size={16} weight="duotone" />
                    Edit rule
                  </LinkButton>
                  {isScheduled(t.ruleWhen) && (
                    <LinkButton href={`/whatsapp?preview=${t.key}`} variant="ghost" scroll={false}>
                      <EyeIcon size={16} weight="duotone" />
                      Preview &amp; run
                    </LinkButton>
                  )}
                </div>
              )
            }
          />
        ))}
      </div>
    </>
  );
}

/** "Edit rule": the prototype's rule form in a dialog opened by ?rule=<key>. */
async function RuleDialog({ u, templates, settings, tkey }: { u: U; templates: Templates; settings: Settings; tkey: string }) {
  const t = templates.find((x) => x.key === tkey);
  if (!t) return null;
  const plans = await db.membershipPlan.findMany({ where: { orgId: u.orgId }, orderBy: { name: "asc" }, select: { id: true, name: true } });
  return (
    <Dialog kicker="Automation" title={t.name} close="/whatsapp" width={560}>
      <RuleForm tkey={t.key} rule={templateRule(t)} plans={plans} quietFrom={settings.quietFrom} quietTo={settings.quietTo} dedupDays={settings.dedupDays} close="/whatsapp" />
    </Dialog>
  );
}

const dialogBtn = "inline-flex py-2.5 leading-[1.2] items-center gap-1.5 rounded-md border px-[18px] text-sm font-semibold whitespace-nowrap";

/** "Preview & run": who the rule reaches today, who it skips, and a button to send to them now. */
async function PreviewDialog({ u, tkey, error }: { u: U; tkey: string; error?: string }) {
  let p: Awaited<ReturnType<typeof previewTemplate>>;
  try {
    p = await previewTemplate(u, tkey);
  } catch {
    return null;
  }
  const n = p.send.length;
  return (
    <Dialog kicker="Automation preview" title={p.template.name} close="/whatsapp" width={600} error={error}>
      {p.sample && <div className="rounded-md bg-bg px-3 py-2.5 text-[13px] whitespace-pre-wrap">{p.sample}</div>}
      <div className="text-sm font-semibold">Will receive ({n})</div>
      {p.send.map((m) => (
        <div key={m.memberId} className="flex justify-between gap-2.5 py-1 text-sm">
          <span>{m.name}</span>
          <span className="text-xs text-muted">
            {m.code} · {m.planName || "—"} · {m.phone}
          </span>
        </div>
      ))}
      {!n && <div className="text-sm text-muted">No one matches this rule today.</div>}
      {p.skipped.length > 0 && (
        <>
          <div className="mt-1.5 text-sm font-semibold">Skipped by rules</div>
          {p.skipped.map((x) => (
            <div key={x.cand.memberId} className="flex justify-between gap-2.5 py-[3px] text-[13px] text-muted">
              <span>{x.cand.name}</span>
              <span>{x.why}</span>
            </div>
          ))}
        </>
      )}
      <form action={runRuleAction.bind(null, tkey)} className="flex justify-end gap-2.5">
        <Link href="/whatsapp" scroll={false} className={`${dialogBtn} border-transparent px-1.5 text-accent hover:bg-accent/10`}>
          Close
        </Link>
        <button disabled={!n} className={`${dialogBtn} border-transparent bg-accent text-accent-ink hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-45`}>
          Send to {n} now
        </button>
      </form>
    </Dialog>
  );
}

async function Log({ u, s, templates }: { u: U; s: (k: string) => string | undefined; templates: Templates }) {
  const f = (FILTERS as readonly string[]).includes(s("status") ?? "") ? s("status")! : "All";
  const page = Math.max(1, Number(s("page") ?? 1) || 1);
  const list = await listMessages(u, { status: f === "All" ? undefined : f, page, pageSize: 20 });
  const name = new Map(templates.map((t) => [t.key, t.name]));
  const href = (st: string, p = 1) => `/whatsapp?tab=log${st !== "All" ? `&status=${st}` : ""}${p > 1 ? `&page=${p}` : ""}`;
  return (
    <>
      <div className="inline-flex flex-wrap self-start overflow-hidden rounded-md border border-line">
        {FILTERS.map((k) => (
          <Link key={k} href={href(k)} className={cx("px-3 py-[7px] text-[13px]", k === f ? "bg-accent text-accent-ink" : "hover:bg-fg/7")}>
            {k}
          </Link>
        ))}
      </div>
      <ScrollRegion label="Whatsapp table">
        <table className={TABLE}>
          <thead>
            <tr>
              {["Sent", "Member", "To", "Message", "Status", ""].map((h, i) => (
                <th key={i} className={TH}>
                  {h || <span className="sr-only">Actions</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {list.rows.map((m) => (
              <tr key={m.id} className="hover:bg-fg/4">
                <td className={cx(TD, "whitespace-nowrap")}>
                  {fmtShort(m.sentAt)}, {fmtTime(m.sentAt)}
                </td>
                <td className={TD}>{m.member ? <Link href={`/members/${m.member.id}`} className="hover:text-accent">{m.member.name}</Link> : "—"}</td>
                <td className={cx(TD, "whitespace-nowrap")}>{m.toNumber}</td>
                <td className={cx(TD, "max-w-[360px] text-[13px]")}>
                  {name.get(m.templateKey) ?? OTHER_NAMES[m.templateKey] ?? m.templateKey}
                  {m.attachment ? " · invoice PDF" : ""}
                  <div className="max-w-[360px] truncate text-muted">{m.body.replace(/\n+/g, " ")}</div>
                  {m.error && <div className="text-alert-700">{m.error}</div>}
                </td>
                <td className={cx(TD, "whitespace-nowrap")}>
                  <Tag label={m.status}>{m.status === "Logged" ? "Logged (demo)" : m.status}</Tag>
                  {m.status === "Scheduled" && m.scheduledFor && (
                    <span className="ml-1.5 text-xs text-muted">
                      until {fmtShort(m.scheduledFor)}, {fmtTime(m.scheduledFor)}
                    </span>
                  )}
                </td>
                <td className={TD}>
                  {m.status === "Failed" && m.memberId && (
                    <form action={retryMessageAction.bind(null, m.id)}>
                      <button className="inline-flex min-h-[34px] items-center rounded-md px-1.5 text-sm font-semibold text-accent hover:bg-accent/10">Retry</button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollRegion>
      {!list.rows.length && <div className="text-sm text-muted">No messages yet. Reminders, receipts and renewal messages appear here as they go out.</div>}
      <Pager page={list.page} pageSize={list.pageSize} total={list.total} href={(p) => href(f, p)} />
    </>
  );
}
