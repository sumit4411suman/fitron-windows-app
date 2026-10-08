import Link from "next/link";
import { headers } from "next/headers";
import { EnvelopeSimpleIcon, GlobeIcon, PhoneIcon, WhatsappLogoIcon } from "@phosphor-icons/react/dist/ssr";
import type { CurrentUser } from "@/lib/auth/current";
import { Button } from "@/components/ui";
import { Tag } from "@/components/tag";
import { FAQ, SUPPORT, supportContacts, systemDetailsText } from "@/lib/domain/support";
import { hasPrioritySupport } from "@/lib/domain/features";
import { gymNameOf, listTickets, supportEnv, systemDetails } from "@/lib/services/support";
import { istClock, todayIso } from "@/lib/services/time";
import { fmtDate } from "@/lib/format";
import { HelpFaq } from "./help-faq";
import { TicketForm } from "./ticket-form";
import { CopyButton } from "./copy-button";
import { resolveTicketAction } from "./actions";

const ICON = { email: EnvelopeSimpleIcon, whatsapp: WhatsappLogoIcon, phone: PhoneIcon, site: GlobeIcon };

export async function HelpTab({ u, waStatus, waMode }: { u: CurrentUser; waStatus: { text: string }; waMode: string }) {
  const h = await headers();
  const [gymName, tickets] = await Promise.all([gymNameOf(u), listTickets(u.orgId)]);
  const rows = await systemDetails(u, { userAgent: h.get("user-agent"), ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null, waStatusText: waStatus.text, waMode });
  const contacts = supportContacts({ gymName, ...supportEnv() });
  return (
    <div className="flex max-w-[900px] flex-col gap-8">
      <section className="flex flex-col gap-3">
        <div>
          <h3 className="text-lg">Contact Fitron support</h3>
          <p className="text-[13px] text-muted">{SUPPORT.hours} · replies within 4 working hours</p>
          {hasPrioritySupport(u.plan) && <p className="mt-1 text-[13px] font-semibold text-accent">Your {u.plan.name} plan includes priority support: your tickets are picked up first.</p>}
        </div>
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,190px),1fr))]">
          {contacts.map((c) => {
            const Icon = ICON[c.key];
            return (
              <a key={c.key} href={c.href} {...(c.external ? { target: "_blank", rel: "noopener" } : {})} className="flex items-center gap-3 rounded-lg border border-line bg-surface p-[14px_16px] hover:border-accent">
                <Icon size={24} weight="duotone" className="text-accent" />
                <span className="min-w-0">
                  <span className="block text-xs text-muted">{c.label}</span>
                  <span className="block truncate text-sm font-semibold">{c.value}</span>
                </span>
              </a>
            );
          })}
        </div>
      </section>

      <HelpFaq faqs={FAQ} />

      <section className="flex flex-col gap-3 rounded-lg bg-surface p-[18px_20px]">
        <h3 className="text-lg">Raise a ticket</h3>
        <TicketForm />
      </section>

      {tickets.length > 0 && (
        <section className="flex flex-col">
          <h3 className="mb-1 text-lg">Your tickets</h3>
          {tickets.map((t) => (
            <div key={t.id} className="flex flex-col gap-1 border-b border-line py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold">
                  {t.subject} <span className="text-xs font-normal text-muted">{t.number}</span>
                </span>
                {t.status === "Resolved" ? <Tag label="Success">Resolved</Tag> : <Tag label="Open">Open</Tag>}
              </div>
              <div className="text-xs text-muted">
                {fmtDate(new Date(t.createdAt.getTime() + 330 * 60_000))} · {t.topic}
                {t.priority === "Urgent" ? " · Urgent" : ""} · {t.raisedBy}
              </div>
              {t.latestReply && <div className="text-[13px]">Support: {t.latestReply}</div>}
              {t.status === "Open" && (
                <form action={resolveTicketAction.bind(null, t.id)}>
                  <Button variant="ghost" className="-ml-2.5 self-start">
                    Mark resolved
                  </Button>
                </form>
              )}
            </div>
          ))}
        </section>
      )}

      <section className="flex max-w-[520px] flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <h3 className="text-base">System details</h3>
          <CopyButton text={systemDetailsText(rows, `${todayIso()} ${istClock()}`)} />
        </div>
        {rows.map((r) => (
          <div key={r.k} className="flex justify-between gap-3 text-[13px]">
            <span className="text-muted">{r.k}</span>
            {r.href ? (
              <Link href={r.href} className="text-right underline">
                {r.v}
              </Link>
            ) : (
              <span className="text-right">{r.v}</span>
            )}
          </div>
        ))}
      </section>
    </div>
  );
}
