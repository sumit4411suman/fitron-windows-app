import { PaperPlaneTiltIcon } from "@phosphor-icons/react/dist/ssr";
import type { CurrentUser } from "@/lib/auth/current";
import { db } from "@/lib/db";
import { getWaSettings } from "@/lib/services/whatsapp";
import { todayIso } from "@/lib/services/time";
import { LinkButton, cx } from "@/components/ui";
import { SectionTabs } from "@/components/section-tabs";

const MODE = { demo: "Demo · messages are logged, not sent", cloud: "WhatsApp Cloud API", connector: "Linked gym phone · automatic" };
const MODE_SHORT = { demo: "Simulated", cloud: "Cloud API", connector: "Linked · automatic" };
const TABS = [
  { href: "/whatsapp", label: "Templates & automation" },
  { href: "/whatsapp?tab=log", label: "Message log" },
];

/** The prototype's WhatsApp header: provider, New campaign, the month's figures and the tabs. */
export async function WaHeader({ u, current }: { u: CurrentUser; current: string }) {
  const s = await getWaSettings(u.orgId);
  const since = new Date(`${todayIso().slice(0, 7)}-01T00:00:00+05:30`);
  const g = await db.whatsAppMessage.groupBy({ by: ["status"], where: { orgId: u.orgId, sentAt: { gte: since }, OR: [{ memberId: null }, { member: { branchId: { in: u.branchIds } } }] }, _count: { _all: true } });
  const n = (st?: string[]) => g.filter((x) => !st || st.includes(x.status)).reduce((a, x) => a + x._count._all, 0);
  const total = n();
  const pct = (k: number) => (total ? `${Math.round((k / total) * 100)}%` : "—");
  const stats: [string, string, boolean?][] = [
    ["Sent this month", total.toLocaleString("en-IN")],
    ["Mode", MODE_SHORT[s.mode]],
    ...(s.mode === "demo" ? [] : ([["Delivered", pct(n(["Delivered", "Read"]))], ["Read", pct(n(["Read"]))]] as [string, string][])),
    ["Failed", n(["Failed"]).toLocaleString("en-IN"), true],
  ];
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-[11px] tracking-[0.1em] text-muted uppercase">{MODE[s.mode]}{s.mode === "connector" && s.linked?.number ? ` · ${s.linked.number}` : ""}</div>
          <h1 className="mt-1 text-[28px] lg:text-[40px]">WhatsApp</h1>
        </div>
        <LinkButton href="/whatsapp/send" variant="primary">
          <PaperPlaneTiltIcon size={17} weight="duotone" />
          New campaign
        </LinkButton>
      </div>
      <div className="flex flex-wrap gap-10">
        {stats.map(([k, v, alert]) => (
          <div key={k}>
            <div className="text-[11px] tracking-[0.08em] text-muted uppercase">{k}</div>
            <div className={cx("text-[26px] font-semibold", alert && v !== "0" && "text-alert-700")}>{v}</div>
          </div>
        ))}
      </div>
      <div className="-mb-6">
        <SectionTabs u={u} tabs={TABS} current={current} />
      </div>
    </>
  );
}
