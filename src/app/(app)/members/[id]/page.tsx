import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import {
  ArrowLeftIcon,
  ArrowsClockwiseIcon,
  ArrowsLeftRightIcon,
  BellRingingIcon,
  ClockCounterClockwiseIcon,
  FileImageIcon,
  FilePdfIcon,
  FilePlusIcon,
  HandCoinsIcon,
  PauseIcon,
  PencilSimpleIcon,
  PlayIcon,
  SnowflakeIcon,
  SunIcon,
  TrashIcon,
  UploadSimpleIcon,
  WhatsappLogoIcon,
} from "@phosphor-icons/react/dist/ssr";
import type { Icon } from "@phosphor-icons/react";
import { requirePermission } from "@/lib/auth/current";
import { db } from "@/lib/db";
import { getMember } from "@/lib/services/members";
import { memberHistory } from "@/lib/services/billing";
import { DOC_KINDS, listDocuments } from "@/lib/services/documents";
import { memberBiometrics } from "@/lib/services/biometric";
import { memberVisits } from "@/lib/services/attendance";
import { memberBookings } from "@/lib/services/classes";
import { listDiets, listRecords, listWorkouts, progressFor } from "@/lib/services/programs";
import { listTrainers } from "@/lib/services/staff";
import { bestRecords } from "@/lib/domain/programs";
import { memberPhotoUrl } from "@/components/avatar";
import { MemberPhotoForm } from "./photo-form";
import { measureAction, removeRecordAction, sendPlanAction } from "../fitness-actions";
import { PlusIcon } from "@phosphor-icons/react/dist/ssr";
import { listMessages, listTemplates } from "@/lib/services/whatsapp";
import { trainerStatusFor } from "@/lib/services/trainer-gym";
import { findPlan } from "@/lib/domain/pricing";
import { openFreeze } from "@/lib/services/freeze";
import { todayIso, toIso } from "@/lib/services/time";
import { addDays, daysBetween } from "@/lib/domain/dates";
import { FREEZE_REASONS } from "@/lib/domain/freeze";
import { InvoiceStatusBadge } from "@/components/invoice-status";
import { MemberStatus } from "@/components/status";
import { Tag } from "@/components/tag";
import { ConfirmButton } from "@/components/confirm-button";
import { Dialog, DialogButtons } from "@/components/dialog";
import { Button, Field, Input, Notice, Select, Textarea, TABLE, TD, TH, TR, cx, ScrollRegion } from "@/components/ui";
import { fmtDate, fmtShort, fmtStamp, fmtTime, formatRupees, initials } from "@/lib/format";
import { remindDueAction } from "../../reminder-actions";
import {
  deleteDocumentAction,
  enrolBiometric,
  eraseBiometric,
  freezeAction,
  removeMember,
  replaceDocumentAction,
  sendInvoiceWaAction,
  toggleSuspend,
  transferAction,
  unfreezeAction,
  uploadDocumentAction,
} from "../actions";
import { AssignForm, RecordForm } from "./fitness";
import { SendOneForm } from "../../whatsapp/wa-forms";

export const metadata = { title: "Member · Fitron" };

const TABS = [
  ["overview", "Overview"],
  ["payments", "Payments"],
  ["invoices", "Invoices"],
  ["memberships", "Renewal history"],
  ["attendance", "Attendance"],
  ["fitness", "Fitness"],
  ["documents", "Documents"],
  ["whatsapp", "WhatsApp"],
] as const;
type TabKey = (typeof TABS)[number][0];

const TYPE_LABEL: Record<string, string> = { NEW: "New", RENEWAL: "Renewal", AUTOPAY: "Autopay", IMPORT: "Imported" };
const btn = "inline-flex py-2.5 leading-[1.2] items-center gap-1.5 rounded-md border text-sm font-semibold whitespace-nowrap";
const BTN = {
  primary: `${btn} px-[18px] border-transparent bg-accent text-accent-ink hover:bg-accent-hover`,
  secondary: `${btn} px-[18px] border-line hover:bg-fg/7`,
  ghost: `${btn} border-transparent px-1.5 text-accent hover:bg-accent/10`,
};

export default async function MemberPage({ params, searchParams }: PageProps<"/members/[id]">) {
  const u = await requirePermission("members.view");
  const { id } = await params;
  const m = await getMember(u, id);
  if (!m) notFound();
  const sp = await searchParams;
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const tab: TabKey = (TABS.find(([k]) => k === str("tab"))?.[0] ?? (str("doc") || str("docError") ? "documents" : "overview")) as TabKey;
  const today = todayIso();
  const here = `/members/${m.id}`;

  const canMoney = u.can("invoices.view");
  const canWa = u.can("whatsapp.send");
  const canPrograms = u.can("programs.manage");
  const canBio = u.can("members.edit") && !m.walkIn;
  const [history, visits, bookings, workouts, diets, progress, records, trainers, freeze, templates, messages, docs] = await Promise.all([
    canMoney ? memberHistory(u, m.id) : null,
    memberVisits(u, m.id, 200),
    u.can("classes.manage") ? memberBookings(m.id) : null,
    listWorkouts(u),
    listDiets(u),
    progressFor(m.id),
    listRecords(m.id),
    listTrainers(u),
    openFreeze(m.id, today),
    canWa ? listTemplates(u.orgId) : [],
    canWa ? listMessages(u, { memberId: m.id }) : null,
    u.can("documents.manage") && !m.walkIn ? listDocuments(u, m.id) : null,
  ]);
  const trainer = m.walkIn ? null : await trainerStatusFor(u, m.id, today);
  const [bio, devices] = canBio && tab === "overview" ? await Promise.all([memberBiometrics(m.id), db.device.findMany({ where: { orgId: u.orgId, approved: true, branchId: { in: u.branchIds } }, orderBy: { createdAt: "asc" } })]) : [null, []];
  const staff = await db.user.findMany({ where: { orgId: u.orgId }, select: { id: true, name: true } });
  const nameOf = (uid: string | null | undefined) => staff.find((x) => x.id === uid)?.name ?? "—";

  const daysLeft = m.latestEnd ? daysBetween(m.latestEnd, today) : null;
  const expired = daysLeft !== null && daysLeft < 0;
  const openInvoices = (history?.invoices ?? []).filter((i) => i.balance > 0 && i.status !== "CANCELLED");
  const lastInvoice = (history?.invoices ?? []).find((i) => i.status !== "CANCELLED");
  const lifetimePaid = (history?.payments ?? []).filter((p) => p.status === "SUCCESS").reduce((a, p) => a + p.amount, 0);
  const visits30 = visits.filter((v) => toIso(v.date) >= addDays(today, -30)).length;
  const current = history?.memberships.find((x) => x.status === "VALID" && toIso(x.startDate) <= today && toIso(x.endDate) >= today) ?? history?.memberships.find((x) => x.status === "VALID");
  const currentInvoice = current ? history?.invoices.find((i) => i.id === current.invoice.id) : undefined;
  const risk = m.riskScore !== null ? (m.riskScore >= 60 ? "High risk" : m.riskScore >= 40 ? "Medium risk" : null) : null;
  const canFreeze = u.can("memberships.renew") && !!m.latestEnd && !expired && !freeze;
  const canTransfer = u.can("members.edit") && u.branches.length > 1;

  const actions: { label: string; icon: Icon; cls: keyof typeof BTN; href?: string; form?: (fd: FormData) => Promise<void>; confirm?: string }[] = [];
  if (u.can("payments.collect") && canMoney)
    actions.push({ label: "Collect payment", icon: HandCoinsIcon, cls: expired ? "secondary" : "primary", href: openInvoices[0] ? `/invoices/${openInvoices.at(-1)!.id}#collect` : "/receivables" });
  if (u.can("memberships.renew")) actions.push({ label: m.latestEnd ? "Renew membership" : "Sell membership", icon: ArrowsClockwiseIcon, cls: expired || !m.latestEnd ? "primary" : "secondary", href: `${here}/sell` });
  if (u.can("invoices.create")) actions.push({ label: "Create invoice", icon: FilePlusIcon, cls: "secondary", href: `/invoices/new?member=${m.id}` });
  if (u.can("members.delete")) actions.push({ label: "Delete member", icon: TrashIcon, cls: "ghost", href: `${here}?do=delete` });
  if (canFreeze) actions.push({ label: "Freeze", icon: SnowflakeIcon, cls: "ghost", href: `${here}?do=freeze` });
  if (freeze && u.can("memberships.renew")) actions.push({ label: "Unfreeze", icon: SunIcon, cls: "ghost", form: unfreezeAction.bind(null, m.id) });
  if (canTransfer) actions.push({ label: "Transfer branch", icon: ArrowsLeftRightIcon, cls: "ghost", href: `${here}?do=transfer` });
  if (canWa && lastInvoice) actions.push({ label: "Send invoice on WhatsApp", icon: WhatsappLogoIcon, cls: "secondary", form: sendInvoiceWaAction.bind(null, m.id, lastInvoice.id, lastInvoice.number, lastInvoice.total) });
  if (canWa && m.outstanding > 0) actions.push({ label: "Send payment reminder", icon: BellRingingIcon, cls: "secondary", form: remindDueAction.bind(null, m.id, openInvoices[0]?.number ?? "", here) });
  if (docs) actions.push({ label: "Upload document", icon: UploadSimpleIcon, cls: "secondary", href: `${here}?tab=documents#upload` });
  if (u.can("members.edit")) actions.push({ label: "Edit member", icon: PencilSimpleIcon, cls: "secondary", href: `${here}/edit` });
  if (u.can("members.edit")) actions.push({ label: m.suspended ? "Resume" : "Suspend", icon: m.suspended ? PlayIcon : PauseIcon, cls: "ghost", form: toggleSuspend.bind(null, m.id, !m.suspended) });
  if (canMoney) actions.push({ label: "Payment history", icon: ClockCounterClockwiseIcon, cls: "ghost", href: `${here}?tab=payments` });

  const stats: [string, string, string?][] = [
    ["Plan", m.planName ?? "—"],
    ["Valid till", m.latestEnd ? fmtShort(m.latestEnd) : "—"],
    ["Days left", daysLeft === null ? "—" : daysLeft < 0 ? "Expired" : String(daysLeft), daysLeft !== null && daysLeft < 0 ? "text-alert-700" : daysLeft !== null && daysLeft <= 7 ? "text-accent-700" : undefined],
    ["Outstanding", formatRupees(m.outstanding), m.outstanding ? "text-alert-700" : undefined],
    ...(canMoney ? ([["Lifetime paid", formatRupees(lifetimePaid)]] as [string, string][]) : []),
    ["Visits · 30 days", String(visits30)],
    ...(risk ? ([["Fitron AI", risk, "text-alert-700"]] as [string, string, string][]) : []),
  ];

  const age = m.dob ? Math.floor(daysBetween(today, toIso(m.dob)) / 365.25) : null;
  const sections: { title: string; rows: [string, ReactNode][] }[] = [
    {
      title: "Personal",
      rows: [
        ["Member ID", m.code],
        ["Full name", m.name],
        ["Date of birth", m.dob ? `${fmtDate(m.dob)} (${age} yrs)` : "—"],
        ["Gender", m.gender],
        ["Occupation", m.occupation || "—"],
        ["Heard about us", m.source],
        ["Tags", m.tags.join(", ") || "—"],
        ["Trainer", m.trainerName ?? "—"],
        ["Branch", m.branch.name],
      ],
    },
    { title: "Contact", rows: [["Mobile", m.phone], ["WhatsApp", m.whatsapp ?? m.phone], ["Email", m.email || "—"]] },
    { title: "Address", rows: [["House / flat", m.house || "—"], ["Area / street", m.area || "—"], ["City", m.city || "—"], ["State", m.state || "—"], ["PIN code", m.pin || "—"]] },
    { title: "Emergency contact", rows: [["Name", m.emergencyName || "—"], ["Relationship", m.emergencyRelation || "—"], ["Phone", m.emergencyPhone || "—"]] },
    ...(trainer
      ? [
          {
            title: "AI Trainer",
            rows: [
              ["Plan", `${findPlan(trainer.plan)?.name ?? trainer.plan} · ${trainer.access === "ACTIVE" ? `paid till ${fmtShort(trainer.paidUntil!)}` : trainer.access === "TRIAL" ? `free trial till ${fmtShort(trainer.trialEndsAt!)}` : "no plan"}`],
              ["This week", `${trainer.weekWorkouts} of ${trainer.weekPlanned} workouts`],
              ["Streak", trainer.streak ? `${trainer.streak} days` : "—"],
              ["Workouts", `${trainer.totalWorkouts} logged`],
              ["Last seen", trainer.lastSeenAt ? fmtStamp(trainer.lastSeenAt) : "—"],
              ["Linked", trainer.linkedAt ? fmtStamp(trainer.linkedAt) : "—"],
              [
                "Partnership",
                <Link key="partnership" className="underline" href="/partnership">
                  All linked members
                </Link>,
              ],
            ] as [string, ReactNode][],
          },
        ]
      : []),
    ...(current
      ? [
          {
            title: "Membership",
            rows: [
              ["Plan", `${current.plan.name}${current.pricingCategory && current.pricingCategory !== "Standard" ? ` · ${current.pricingCategory}` : ""}`],
              ["Type", TYPE_LABEL[current.type] ?? current.type],
              ["Start date", fmtDate(current.startDate)],
              ["End date", fmtDate(current.endDate)],
              ["Status", <MemberStatus key="s" status={m.status} />],
              ["Price", formatRupees(current.price)],
              ["Discount", formatRupees(current.discount)],
              ...(current.offerCode ? ([["Offer code", current.offerCode]] as [string, string][]) : []),
              ["Final amount", currentInvoice ? formatRupees(currentInvoice.total) : "—"],
              ["Amount paid", currentInvoice ? formatRupees(currentInvoice.paid) : "—"],
              ["Pending", currentInvoice ? formatRupees(currentInvoice.balance) : "—"],
              ["Payment status", currentInvoice ? <InvoiceStatusBadge key="p" status={currentInvoice.status} overdueDays={currentInvoice.overdueDays} /> : "—"],
              ["Renewal date", fmtDate(addDays(toIso(current.endDate), 1))],
              ...(freeze ? ([["Frozen", `${fmtDate(freeze.fromDate)} – ${fmtDate(freeze.lastDay)} · ${freeze.reason}`]] as [string, string][]) : []),
            ] as [string, ReactNode][],
          },
        ]
      : []),
    { title: "Notes", rows: [["Notes", m.notes || "—"], ["Staff notes", m.staffNotes || "—"], ["Created by", nameOf(m.createdById)], ["Joined", fmtStamp(m.createdAt)]] },
  ];

  return (
    <div className="flex flex-col gap-8 pt-3">
      <Link href="/members" className={cx(BTN.ghost, "self-start")}>
        <ArrowLeftIcon weight="duotone" />
        All members
      </Link>
      {str("msg") && <Notice tone="ok">{str("msg")}</Notice>}

      <div className="flex flex-wrap items-center gap-6">
        {m.photoKey ? (
          <div role="img" aria-label="Member photo" className="size-24 rounded-full bg-neutral-200 bg-cover bg-center" style={{ backgroundImage: `url(${memberPhotoUrl(m.id, m.photoKey)})` }} />
        ) : (
          <div className="grid size-24 place-items-center rounded-full bg-neutral-200 text-[32px] font-semibold">{initials(m.name)}</div>
        )}
        <div className="min-w-[240px] flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="m-0 text-[28px] lg:text-[38px]">{m.name}</h1>
            {freeze ? <Tag label="Paused">FROZEN</Tag> : <MemberStatus status={m.status} className="text-xs!" />}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-[18px] text-sm text-muted">
            <span>{m.code}</span>
            <span>{m.phone}</span>
            <span>{m.planName ?? "No membership yet"}</span>
            {m.latestEnd && <span>Expires {fmtDate(m.latestEnd)}</span>}
          </div>
        </div>
      </div>

      {u.can("members.edit") && !m.walkIn && <MemberPhotoForm memberId={m.id} hasPhoto={!!m.photoKey} />}

      <div className="flex flex-wrap gap-2">
        {actions.map((a) =>
          a.href ? (
            <Link key={a.label} href={a.href} className={BTN[a.cls]}>
              <a.icon size={16} weight="duotone" />
              {a.label}
            </Link>
          ) : a.confirm ? (
            <form key={a.label} action={a.form!}>
              <ConfirmButton variant="ghost" confirm={a.confirm} className="gap-1.5">
                <a.icon size={16} weight="duotone" />
                {a.label}
              </ConfirmButton>
            </form>
          ) : (
            <form key={a.label} action={a.form!}>
              <button className={BTN[a.cls]}>
                <a.icon size={16} weight="duotone" />
                {a.label}
              </button>
            </form>
          ),
        )}
      </div>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-6">
        {stats.map(([k, v, tone]) => (
          <div key={k}>
            <div className="text-[11px] tracking-[0.08em] text-muted uppercase">{k}</div>
            <div className={cx("text-2xl font-semibold", tone)}>{v}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-1 overflow-x-auto">
        {TABS.filter(([k]) => (k !== "payments" && k !== "invoices" && k !== "memberships") || canMoney)
          .filter(([k]) => k !== "documents" || docs)
          .filter(([k]) => k !== "whatsapp" || canWa)
          .map(([k, label]) => (
            <Link key={k} href={k === "overview" ? here : `${here}?tab=${k}`} className={cx("border-b-2 px-3 py-2 text-sm", tab === k ? "border-accent text-fg" : "border-transparent text-muted")}>
              {label}
            </Link>
          ))}
      </div>

      {tab === "overview" && (
        <>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,300px),1fr))] gap-x-14 gap-y-10">
            {sections.map((sec) => (
              <section key={sec.title}>
                <h4 className="mb-2.5 text-lg">{sec.title}</h4>
                {sec.rows.map(([k, v]) => (
                  <div key={k} className="grid grid-cols-[140px_minmax(0,1fr)] gap-3 py-1.5 text-sm">
                    <span className="text-muted">{k}</span>
                    <span className="break-words whitespace-pre-wrap">{v}</span>
                  </div>
                ))}
              </section>
            ))}
          </div>
          {bio && <Biometric m={m} bio={bio} devices={devices} canSettings={u.can("settings.manage")} ok={str("bio")} err={str("bioError")} />}
        </>
      )}

      {tab === "payments" && history && (
        <Table
          head={["Payment ID", "Date", "Invoice", "Method", "Transaction ID", "Received by", "Status", "Amount"]}
          right={[7]}
          empty={history.payments.length === 0 ? "No payments recorded." : undefined}
          rows={history.payments.map((p) => [
            p.code,
            fmtDate(p.date),
            <Link key="i" href={`/invoices/${p.invoice.id}`} className="hover:text-accent">
              {p.invoice.number}
            </Link>,
            p.method,
            p.txnRef || "—",
            nameOf(p.receivedById),
            <Tag key="t" label={p.status === "SUCCESS" ? "Success" : "Failed"}>
              {p.status === "SUCCESS" ? "Success" : "Reversed"}
            </Tag>,
            formatRupees(p.amount),
          ])}
        />
      )}

      {tab === "invoices" && history && (
        <Table
          head={["Invoice", "Date", "Items", "Total", "Paid", "Balance", "Status"]}
          right={[3, 4, 5]}
          empty={history.invoices.length === 0 ? "No invoices yet." : undefined}
          rows={history.invoices.map((i) => [
            <Link key="n" href={`/invoices/${i.id}`} className="hover:text-accent">
              {i.number}
            </Link>,
            fmtDate(i.date),
            i.items.map((x) => x.description.split(" (")[0]).join(", "),
            formatRupees(i.total),
            formatRupees(i.paid),
            formatRupees(i.balance),
            <InvoiceStatusBadge key="s" status={i.status} overdueDays={i.overdueDays} />,
          ])}
        />
      )}

      {tab === "memberships" && history && (
        <Table
          head={["Membership ID", "Plan", "Type", "Start", "End", "Invoice", "Amount"]}
          right={[6]}
          empty={history.memberships.length === 0 ? "No memberships yet." : undefined}
          rows={history.memberships.map((x) => [
            x.code,
            x.plan.name,
            <>
              {TYPE_LABEL[x.type] ?? x.type}
              {x.status === "CANCELLED" && <span className="ml-1.5 text-alert-700">· Cancelled</span>}
            </>,
            fmtDate(x.startDate),
            fmtDate(x.endDate),
            <Link key="i" href={`/invoices/${x.invoice.id}`} className="hover:text-accent">
              {x.invoice.number}
            </Link>,
            formatRupees(x.price - x.discount),
          ])}
        />
      )}

      {tab === "attendance" && (
        <>
          <p className="text-sm text-muted">
            {visits30} visits in the last 30 days{visits[0] ? ` · last visit ${fmtDate(visits[0].date)}` : ""}
          </p>
          <Table
            head={["Date", "Check-in", "Check-out", "Duration", "Method"]}
            rows={visits.slice(0, 40).map((v) => [
              fmtDate(v.date),
              fmtTime(v.checkIn),
              v.checkOut ? fmtTime(v.checkOut) : "In the gym",
              v.checkOut ? `${Math.round((v.checkOut.getTime() - v.checkIn.getTime()) / 60000)} min` : "—",
              `${v.method}${v.override ? " · override" : ""}`,
            ])}
          />
          {bookings && bookings.length > 0 && (
            <section>
              <h4 className="mb-2.5 text-lg">Class bookings</h4>
              <Table
                head={["Class", "Date", "Status"]}
                rows={bookings.map((b) => [
                  <Link key="c" href={`/classes/${b.classSlot.id}?date=${toIso(b.date)}`} className="hover:text-accent">
                    {b.classSlot.name}
                  </Link>,
                  fmtDate(b.date),
                  <Tag key="t" label={b.status} />,
                ])}
              />
            </section>
          )}
        </>
      )}

      {tab === "fitness" && (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,320px),1fr))] gap-x-14 gap-y-10">
          <section className="flex flex-col gap-3">
            <h4 className="m-0 text-lg">Program</h4>
            {canPrograms || u.can("members.edit") ? (
              <AssignForm memberId={m.id} trainers={trainers} workouts={workouts.filter((w) => w.active || w.id === m.workoutPlanId)} diets={diets.filter((d) => d.active || d.id === m.dietPlanId)} trainerId={m.trainerId} workoutId={m.workoutPlanId} dietId={m.dietPlanId} />
            ) : (
              <p className="text-sm">
                Trainer: {m.trainerName ?? "—"} · Workout: {workouts.find((w) => w.id === m.workoutPlanId)?.name ?? "None"} · Diet: {diets.find((d) => d.id === m.dietPlanId)?.name ?? "None"}
              </p>
            )}
            {workouts
              .find((w) => w.id === m.workoutPlanId)
              ?.days.map((d) => (
                <div key={d.name}>
                  <div className="mt-1.5 text-sm font-semibold">{d.name}</div>
                  {d.exercises.map((x) => (
                    <div key={x.name} className="flex justify-between py-[3px] text-[13px]">
                      <span>{x.name}</span>
                      <span className="text-muted">{x.sets}</span>
                    </div>
                  ))}
                </div>
              ))}
            {canWa && (
              <div className="flex flex-wrap gap-2">
                <form action={sendPlanAction.bind(null, m.id)}>
                  <button className={BTN.secondary}>
                    <WhatsappLogoIcon size={16} weight="duotone" />
                    Send plan on WhatsApp
                  </button>
                </form>
              </div>
            )}
          </section>
          <section className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <h4 className="m-0 text-lg">Progress</h4>
              {canPrograms && (
                <Link href={`${here}?tab=fitness&do=measure`} className={BTN.secondary}>
                  <PlusIcon size={16} weight="bold" />
                  Log measurement
                </Link>
              )}
            </div>
            {progress.length > 0 ? (
              <>
                <ProgressStats progress={progress} />
                <Table
                  head={["Date", "Weight", "Body fat", "Waist"]}
                  right={[1, 2, 3]}
                  rows={progress.map((p) => [fmtDate(p.date), p.weightKg != null ? `${p.weightKg} kg` : "—", p.bodyFat != null ? `${p.bodyFat}%` : "—", p.waistCm != null ? `${p.waistCm} cm` : "—"])}
                />
              </>
            ) : (
              <p className="m-0 text-sm text-muted">No measurements logged yet.</p>
            )}
            {(canPrograms || records.length > 0) && (
              <>
                <h4 className="mt-2 mb-0 text-base">Personal records</h4>
                {records.length === 0 && <p className="m-0 text-sm text-muted">No personal records yet.</p>}
                {bestRecords(records).map((r) => (
                  <div key={r.id} className="flex items-center justify-between gap-3 py-1 text-sm">
                    <span>{r.lift}</span>
                    <span className="flex items-center gap-2">
                      <span>
                        <strong>
                          {r.weightKg} kg{r.reps > 1 ? ` × ${r.reps}` : ""}
                        </strong>{" "}
                        <span className="text-xs text-muted">{fmtDate(r.date)}</span>
                      </span>
                      {canPrograms && (
                        <form action={removeRecordAction.bind(null, m.id, r.id)}>
                          <ConfirmButton variant="ghost" confirm="Remove this record?">
                            Remove
                          </ConfirmButton>
                        </form>
                      )}
                    </span>
                  </div>
                ))}
                {canPrograms && <RecordForm memberId={m.id} today={today} />}
              </>
            )}
          </section>
        </div>
      )}

      {tab === "documents" && docs && <Documents memberId={m.id} docs={docs} ok={str("doc")} err={str("docError")} />}

      {tab === "whatsapp" && canWa && (
        <div className="grid gap-10 lg:grid-cols-2">
          <div className="flex max-w-[640px] flex-col gap-3.5">
            {messages?.rows.slice(0, 40).map((w) => (
              <div key={w.id} className="flex flex-col gap-1">
                <div className="flex items-center gap-2.5 text-xs text-muted">
                  <WhatsappLogoIcon size={15} weight="duotone" className="text-accent" />
                  <span>
                    {templates.find((t) => t.key === w.templateKey)?.name ?? w.templateKey}
                    {w.attachment ? " · PDF" : ""} · {fmtDate(todayIso(w.sentAt))}, {fmtTime(w.sentAt)}
                  </span>
                  <Tag label={w.status} />
                </div>
                <div className="rounded-lg bg-surface px-3.5 py-2.5 text-sm whitespace-pre-wrap">{w.body}</div>
              </div>
            ))}
            {!messages?.rows.length && <p className="text-muted">No messages sent yet.</p>}
          </div>
          <SendOneForm
            memberId={m.id}
            templates={templates.map((t) => ({ key: t.key, name: t.name, body: t.body }))}
            invoices={(history?.invoices ?? []).filter((i) => i.status !== "CANCELLED").map((i) => ({ id: i.id, number: i.number }))}
          />
        </div>
      )}

      {str("do") === "measure" && canPrograms && tab === "fitness" && (
        <Dialog kicker={m.name} title="Log measurement" close={`${here}?tab=fitness`} error={str("err")}>
          <form action={measureAction.bind(null, m.id)} className="flex flex-col gap-3.5">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Date">
                <Input name="date" type="date" max={today} defaultValue={today} required />
              </Field>
              <Field label="Weight (kg)">
                <Input name="weightKg" inputMode="decimal" defaultValue={progress.find((p) => p.weightKg != null)?.weightKg ?? ""} />
              </Field>
              <Field label="Body fat (%)">
                <Input name="bodyFat" inputMode="decimal" />
              </Field>
              <Field label="Waist (cm)">
                <Input name="waistCm" inputMode="decimal" />
              </Field>
              <Field label="Notes" className="col-span-2">
                <Textarea name="notes" />
              </Field>
            </div>
            <DialogButtons close={`${here}?tab=fitness`} label="Save" />
          </form>
        </Dialog>
      )}

      {str("do") === "delete" && u.can("members.delete") && (
        <Dialog kicker={m.name} title={`Delete ${m.name}?`} close={here} error={str("err")}>
          <p className="m-0 text-sm">The member is removed from lists, renewals, reminders and door access. Invoices, payments and attendance stay in your books and reports. You can restore them from Members › Recently deleted.</p>
          <form action={removeMember.bind(null, m.id)} className="flex flex-col gap-3.5">
            <Field label="Reason (recorded in the audit log) *">
              <Textarea name="reason" required minLength={3} className="min-h-[70px]" autoFocus />
            </Field>
            <DialogButtons close={here} label="Delete member" cancelLabel="Keep it" danger />
          </form>
        </Dialog>
      )}

      {str("do") === "freeze" && canFreeze && (
        <Dialog kicker={m.name} title="Freeze membership" close={here} error={str("err")} note="The end date moves forward by the frozen days. Check-in is blocked while frozen. Unfreezing early gives back the unused days.">
          <form action={freezeAction.bind(null, m.id)} className="flex flex-col gap-3.5">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-[5px] text-sm">
                <span className="text-xs text-fg/70">Days to freeze</span>
                <Input name="days" type="number" min={1} max={90} defaultValue={15} required />
              </label>
              <label className="flex flex-col gap-[5px] text-sm">
                <span className="text-xs text-fg/70">From</span>
                <Input name="from" type="date" min={today} defaultValue={today} required />
              </label>
              <label className="flex flex-col gap-[5px] text-sm sm:col-span-2">
                <span className="text-xs text-fg/70">Reason</span>
                <Select name="reason" defaultValue="Travel">
                  {FREEZE_REASONS.map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </Select>
              </label>
            </div>
            <DialogButtons close={here} label="Freeze" />
          </form>
        </Dialog>
      )}

      {str("do") === "transfer" && canTransfer && (
        <Dialog kicker={m.name} title="Transfer to another branch" close={here} error={str("err")} note={`Currently at ${m.branch.name}. Membership dates and balance move with the member. Past invoices stay with ${m.branch.name}.`}>
          <form action={transferAction.bind(null, m.id)} className="flex flex-col gap-3.5">
            <label className="flex flex-col gap-[5px] text-sm">
              <span className="text-xs text-fg/70">Move to</span>
              <Select name="to" required defaultValue="">
                <option value="" disabled>
                  Choose
                </option>
                {u.branches
                  .filter((b) => b.id !== m.branchId && b.active)
                  .map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
              </Select>
            </label>
            <label className="flex flex-col gap-[5px] text-sm">
              <span className="text-xs text-fg/70">Reason (optional)</span>
              <Input name="reason" placeholder="Moved house" />
            </label>
            <DialogButtons close={here} label="Transfer" />
          </form>
        </Dialog>
      )}
    </div>
  );
}

function Table({ head, rows, right = [], empty }: { head: string[]; rows: ReactNode[][]; right?: number[]; empty?: string }) {
  if (empty) return <p className="text-muted">{empty}</p>;
  return (
    <ScrollRegion label="Membership history">
      <table className={TABLE}>
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={h} className={cx(TH, right.includes(i) && "text-right")}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, k) => (
            <tr key={k} className={TR}>
              {r.map((c, i) => (
                <td key={i} className={cx(TD, right.includes(i) && "text-right", "whitespace-nowrap")}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollRegion>
  );
}

function ProgressStats({ progress }: { progress: Awaited<ReturnType<typeof progressFor>> }) {
  const withW = progress.filter((p) => p.weightKg != null);
  if (!withW.length) return null;
  const last = withW[0]!;
  const first = withW.at(-1)!;
  const dw = (last.weightKg ?? 0) - (first.weightKg ?? 0);
  const ws = [...withW].reverse().map((p) => p.weightKg!);
  const mn = Math.min(...ws);
  const mx = Math.max(...ws);
  const pts = ws.map((w, i) => `${(ws.length > 1 ? (i / (ws.length - 1)) * 300 : 150).toFixed(1)},${(mx === mn ? 40 : 70 - ((w - mn) / (mx - mn)) * 60).toFixed(1)}`).join(" ");
  return (
    <>
      <div className="flex flex-wrap gap-8">
        <div>
          <div className="text-[11px] tracking-[0.08em] text-muted uppercase">Weight</div>
          <div className="text-[22px] font-semibold">{last.weightKg} kg</div>
          <div className="text-xs text-muted">
            {dw >= 0 ? "+" : ""}
            {dw.toFixed(1)} kg since {fmtShort(first.date)}
          </div>
        </div>
        {last.bodyFat != null && (
          <div>
            <div className="text-[11px] tracking-[0.08em] text-muted uppercase">Body fat</div>
            <div className="text-[22px] font-semibold">{last.bodyFat}%</div>
          </div>
        )}
      </div>
      <svg viewBox="0 0 300 80" preserveAspectRatio="none" className="block h-20 w-full" aria-hidden="true">
        <polyline points={pts} fill="none" stroke="var(--accent)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg>
    </>
  );
}

function Documents({ memberId, docs, ok, err }: { memberId: string; docs: Awaited<ReturnType<typeof listDocuments>>; ok?: string; err?: string }) {
  const live = docs.filter((d) => d.status === "ACTIVE");
  const past = docs.filter((d) => d.status !== "ACTIVE");
  return (
    <div className="flex flex-col gap-4">
      {ok && <Notice tone="ok">{ok}</Notice>}
      {err && <Notice tone="alert">{err}</Notice>}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="m-0 text-sm text-muted">Stored privately against this member. Access is logged.</p>
        <a href="#upload" className={BTN.primary}>
          <UploadSimpleIcon size={16} weight="duotone" />
          Upload document
        </a>
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4">
        {live.map((d) => {
          const I = d.mime === "application/pdf" ? FilePdfIcon : FileImageIcon;
          return (
            <div key={d.id} className="flex flex-col gap-2.5 rounded-md bg-surface p-[15px]">
              <div className="text-[10px] tracking-[0.1em] text-accent uppercase">{d.kind}</div>
              <div className="flex items-center gap-2.5">
                <I size={28} weight="duotone" className="text-accent" />
                <div className="min-w-0">
                  <div className="text-[15px] font-semibold break-words">{d.title}</div>
                  <div className="text-[11px] text-fg/50">
                    {Math.max(1, Math.round(d.size / 1024))} KB · {fmtStamp(d.createdAt)} · {d.uploadedBy}
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap gap-1">
                <a href={`/documents/${d.id}`} target="_blank" rel="noopener" className={BTN.ghost}>
                  Preview
                </a>
                <a href={`/documents/${d.id}?download`} className={BTN.ghost}>
                  Download
                </a>
              </div>
              <details className="text-sm">
                <summary className="cursor-pointer text-accent">Replace or delete</summary>
                <div className="mt-2 flex flex-col gap-2">
                  <form action={replaceDocumentAction.bind(null, memberId, d.id)} className="flex flex-wrap items-center gap-2">
                    <input type="file" name="file" required accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,application/pdf,image/*" aria-label="New file" className="max-w-full text-sm" />
                    <Button>Replace</Button>
                  </form>
                  <form action={deleteDocumentAction.bind(null, memberId, d.id)} className="flex flex-wrap items-center gap-2">
                    <Input name="reason" required placeholder="Reason for deleting" aria-label="Reason for deleting" className="w-auto flex-1" />
                    <Button variant="danger">Delete</Button>
                  </form>
                </div>
              </details>
            </div>
          );
        })}
      </div>
      {live.length === 0 && <p className="text-muted">No documents yet. Upload the signed registration form and ID proof.</p>}
      <form id="upload" action={uploadDocumentAction.bind(null, memberId)} className="flex max-w-xl scroll-mt-24 flex-col gap-2 rounded-lg border border-line bg-surface p-4">
        <h4 className="m-0 text-base">Upload document</h4>
        <div className="grid gap-2 sm:grid-cols-2">
          <Select name="kind" aria-label="Kind of document" defaultValue="ID proof">
            {DOC_KINDS.map((k) => (
              <option key={k}>{k}</option>
            ))}
          </Select>
          <Input name="title" placeholder="Title, e.g. Aadhaar card" aria-label="Title" maxLength={80} />
        </div>
        <input type="file" name="file" required accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,application/pdf,image/*" aria-label="File" className="max-w-full text-sm" />
        <div>
          <Button variant="primary">
            <UploadSimpleIcon weight="duotone" />
            Upload document
          </Button>
        </div>
        <p className="m-0 text-xs text-muted">PDF or photo, up to 10 MB. Files are private; every view is recorded in the audit log.</p>
      </form>
      {past.length > 0 && (
        <section>
          <h4 className="mt-3 mb-1 text-[17px]">Document history</h4>
          {past.map((d) => (
            <div key={d.id} className="py-1 text-[13px] text-muted">
              {fmtStamp(d.createdAt)} · {d.title} · {d.status === "REPLACED" ? "replaced by a newer version" : `deleted by ${d.deletedBy}: ${d.deleteReason}`}
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

function Biometric({
  m,
  bio,
  devices,
  canSettings,
  ok,
  err,
}: {
  m: { id: string; devicePin: string | null; cardNo: string | null; biometricConsentAt: Date | null };
  bio: Awaited<ReturnType<typeof memberBiometrics>>;
  devices: { id: string; name: string | null; serial: string }[];
  canSettings: boolean;
  ok?: string;
  err?: string;
}) {
  return (
    <section id="biometric" className="flex max-w-2xl flex-col gap-3 text-sm">
      <h4 className="m-0 text-lg">Biometric entry</h4>
      {ok && <Notice tone="ok">{ok}</Notice>}
      {err && <Notice tone="alert">{err}</Notice>}
      <p className="m-0">
        {m.devicePin ? `Device PIN ${m.devicePin}` : "Not on any device yet"}
        {m.cardNo ? ` · RFID card ${m.cardNo}` : ""}
        {bio.fingerprints || bio.faces ? ` · ${bio.fingerprints} fingerprint${bio.fingerprints === 1 ? "" : "s"}, ${bio.faces} face${bio.faces === 1 ? "" : "s"} stored (encrypted)` : ""}
        {bio.devices.length ? ` · on ${bio.devices.map((d) => `${d.device.name ?? d.device.serial}${d.allowed ? "" : " (removed, plan not active)"}`).join(", ")}` : ""}
      </p>
      {m.biometricConsentAt && <p className="m-0 text-muted">Consent recorded {fmtStamp(m.biometricConsentAt)}.</p>}
      {devices.length === 0 ? (
        <p className="m-0 text-muted">
          No door device yet.{" "}
          {canSettings ? (
            <Link href="/settings/devices" className="text-accent">
              Add one in Biometric &amp; doors.
            </Link>
          ) : (
            "Ask a Super Admin to add one."
          )}
        </p>
      ) : (
        <form action={enrolBiometric.bind(null, m.id)} className="flex flex-col gap-2">
          <div className="grid gap-2 sm:grid-cols-2">
            <Select name="deviceId" aria-label="Device">
              {devices.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name ?? d.serial}
                </option>
              ))}
            </Select>
            <Select name="kind" aria-label="What to enrol">
              <option value="FP">Fingerprint</option>
              <option value="FACE">Face</option>
            </Select>
          </div>
          {!m.biometricConsentAt && (
            <label className="flex items-start gap-2">
              <input type="checkbox" name="consent" className="mt-0.5 size-4" />
              <span>The member has given written consent to store their fingerprint or face for gym entry, and knows they can ask for it to be deleted.</span>
            </label>
          )}
          <div>
            <Button variant="primary">Enrol on device</Button>
          </div>
        </form>
      )}
      {(m.devicePin || m.biometricConsentAt || m.cardNo) && (
        <form action={eraseBiometric.bind(null, m.id)}>
          <ConfirmButton variant="danger" confirm="Delete this member's fingerprints and face data here and on every device?">
            Delete biometric data
          </ConfirmButton>
        </form>
      )}
    </section>
  );
}

