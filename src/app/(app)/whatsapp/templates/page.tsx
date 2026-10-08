import { LightningIcon } from "@phosphor-icons/react/dist/ssr";
import { requirePermission } from "@/lib/auth/current";
import { getWaSettings, listTemplates } from "@/lib/services/whatsapp";
import { ruleSentence } from "@/lib/services/wa-automation";
import { db } from "@/lib/db";
import { fmtClock } from "@/lib/format";
import { Notice, ScrollRegion } from "@/components/ui";
import { VARS } from "@/lib/domain/whatsapp";
import { TemplateForm } from "../wa-forms";
import { WaHeader } from "../wa-header";

export const metadata = { title: "WhatsApp templates · Fitron" };

export default async function TemplatesPage() {
  const u = await requirePermission("settings.manage");
  const [templates, s, plans] = await Promise.all([listTemplates(u.orgId), getWaSettings(u.orgId), db.membershipPlan.findMany({ where: { orgId: u.orgId }, select: { id: true, name: true } })]);
  const planNames = new Map(plans.map((p) => [p.id, p.name]));
  return (
    <div className="flex flex-col gap-6 pt-4">
      <WaHeader u={u} current="/whatsapp/templates" />
      <section className="flex flex-col gap-2.5 rounded-lg bg-surface px-5 py-[18px]">
        <h3 className="text-[17px]">Automation</h3>
        <p className="m-0 text-sm text-muted">
          Templates marked Auto-send go out each morning from their rules. Quiet hours {fmtClock(s.quietFrom)} – {fmtClock(s.quietTo)}: automatic messages are held until quiet hours end. The same reminder is never repeated within {s.dedupDays} days.
        </p>
        <p className="m-0 text-xs text-muted">Variables: {VARS.map((v) => `{{${v}}}`).join(" ")}</p>
      </section>
      {s.mode === "cloud" && (
        <Notice>
          The Cloud API only delivers messages that start a conversation when they use a template Meta has approved. Create each template in Meta Business Manager with the same text, using {"{{1}}"}, {"{{2}}"}… for the variables in the order they appear here, then enter its name below.
        </Notice>
      )}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,340px),1fr))] gap-5">
        {templates.map((t) => (
          <div key={t.key} className="flex flex-col gap-2.5 rounded-lg border border-line bg-surface p-[18px]">
            <div className="flex items-center justify-between gap-2">
              <div className="text-[11px] tracking-[0.08em] text-muted uppercase">{t.trigger}</div>
              <span className="text-xs text-muted">{t.autoSend ? "Auto-send on" : "Auto-send off"}</span>
            </div>
            <div className="text-lg font-semibold">{t.name}</div>
            <ScrollRegion both label={`${t.name} message text`} className="max-h-[170px] rounded-md bg-bg px-3 py-2.5 text-[13px] whitespace-pre-wrap">{t.body}</ScrollRegion>
            <div className="flex items-start gap-2 text-[13px]">
              <LightningIcon size={16} weight="duotone" className="mt-0.5 shrink-0 text-accent" />
              <span>{ruleSentence(t, s, planNames)}</span>
            </div>
            <details>
              <summary className="cursor-pointer text-sm font-semibold text-accent">Edit</summary>
              <div className="mt-3">
                <TemplateForm tkey={t.key} body={t.body} metaTemplateName={t.metaTemplateName} language={t.language} autoSend={t.autoSend} />
              </div>
            </details>
          </div>
        ))}
      </div>
    </div>
  );
}
