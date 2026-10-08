import { requirePermission } from "@/lib/auth/current";
import { db } from "@/lib/db";
import { getGymProfile, getSetting } from "@/lib/services/settings";
import { countConsented, getPrivacySettings, listPrivacyRequests } from "@/lib/services/privacy";
import { renderNotice } from "@/lib/domain/privacy";
import { memberOptions } from "@/lib/services/members";
import { PrivacyRequestForms } from "./privacy-forms";
import { ChangeCookieChoice } from "@/components/cookie-banner";
import { getTax } from "@/lib/services/tax";
import { nextInvoiceNumber } from "@/lib/services/billing";
import { Button, Field, Input, LinkButton, Notice, Select, Textarea } from "@/components/ui";
import { gymLogoUrl } from "@/components/gym-logo";
import { LogoForm } from "./logo-form";
import { TaxForm } from "./tax-form";
import { SETTINGS_TABS, SectionTabs } from "@/components/section-tabs";
import { makeTrainerCode, saveAi, saveAutopay, saveGym, saveCookieNotice, saveNumbering, savePrivacyNotice, savePrivacyOfficer, saveReminders, saveReports, resubmitTemplatesAction, saveWhatsApp, sendTestAction, testAutopayConnection, unlinkAction } from "./actions";
import { getReminderSettings, getWaSettings, listTemplates } from "@/lib/services/whatsapp";
import { reminderSchedule } from "@/lib/services/reminders";
import { monthlyPlOn } from "@/lib/services/pl-email";
import { LinkWatcher } from "./link-watcher";
import { CloudConnect } from "./cloud-connect";
import { getCloudCreds, getCloudInfo } from "@/lib/services/wa-cloud-store";
import { cloudTemplateStatus } from "@/lib/services/wa-connect";
import { signupConfig } from "@/lib/integrations/whatsapp-cloud";
import { Dialog } from "@/components/dialog";
import { ConfirmButton } from "@/components/confirm-button";
import { PaperPlaneTiltIcon, PlugsIcon, QrCodeIcon, WhatsappLogoIcon } from "@phosphor-icons/react/dist/ssr";
import { fmtClock, fmtDate, fmtShort, fmtStamp, fmtTime } from "@/lib/format";
import { connectorAddress, HOSTED_NEEDS_CONNECTOR, providerReady } from "@/lib/integrations/whatsapp";
import { getAccessRules } from "@/lib/services/attendance";
import { JOBS, recentRuns } from "@/lib/services/jobs";
import { todayIso } from "@/lib/services/time";
import { EXPIRY_CHIPS, expiryChipLabel, scheduledJobRows } from "@/lib/domain/reminders";
import { getAutopaySettings } from "@/lib/services/autopay";
import { getAiSettings } from "@/lib/services/ai-settings";
import { autopayStatusText, deviceStatusText } from "@/lib/domain/integrations";
import { canOpen } from "@/lib/nav";
import { providerStatus } from "@/lib/integrations/whatsapp";
import Link from "next/link";
import { appUrl } from "@/lib/services/accounts";
import { HelpTab } from "./help-tab";
import { BranchesTab } from "./branches-tab";
import { PARTNER_SHARE } from "@/lib/domain/pricing";

export const metadata = { title: "Settings · Fitron" };

export default async function SettingsPage({ searchParams }: PageProps<"/settings">) {
  const u = await requirePermission("settings.manage");
  const sp = await searchParams;
  const section = typeof sp.section === "string" ? sp.section : typeof sp.saved === "string" ? sp.saved : undefined;
  const asked =
    typeof sp.tab === "string"
      ? sp.tab
      : (
          {
            gym: "gym",
            numbering: "gym",
            tax: "billing",
            reminders: "reminders",
            whatsapp: "wa",
            autopay: "int",
            ai: "int",
            branches: "branches",
            privacy: "privacy",
          } as Record<string, string>
        )[section ?? ""];
  const tab = ["gym", "billing", "reminders", "wa", "int", "branches", "privacy", "help"].includes(asked ?? "") ? asked! : "gym";
  const [gym, tax, nextInvoice, numbering, branches, wa, autopay] = await Promise.all([
    getGymProfile(u.orgId),
    getTax(u.orgId),
    nextInvoiceNumber(u.orgId),
    getSetting<{
      memberPrefix?: string;
      invoicePrefix?: string;
      paymentPrefix?: string;
    }>(u.orgId, "numbering"),
    db.branch.findMany({
      where: { orgId: u.orgId },
      orderBy: { createdAt: "asc" },
    }),
    getWaSettings(u.orgId),
    getAutopaySettings(u.orgId),
  ]);
  const [cloudInfo, cloudCreds] = await Promise.all([getCloudInfo(u.orgId), getCloudCreds(u.orgId)]);
  const waStatus = await providerStatus(wa.mode, u.orgId, cloudCreds);
  const templateStatus = tab === "wa" && wa.mode === "cloud" && cloudInfo ? await cloudTemplateStatus(u.orgId) : null;
  const meta = signupConfig();
  const reminders =
    tab === "reminders"
      ? await (async () => {
          const [stored, schedule, access, templates, runs, monthlyPl] = await Promise.all([getReminderSettings(u.orgId), reminderSchedule(u.orgId), getAccessRules(u.orgId), listTemplates(u.orgId), recentRuns(u.orgId), monthlyPlOn(u.orgId)]);
          // The expiry days and birthday wishes are the templates' Auto-send switches, which the rule engine reads.
          const settings = { ...stored, ...schedule };
          const today = todayIso();
          return {
            settings,
            monthlyPl,
            graceDays: access.graceDays,
            jobs: scheduledJobRows(settings, {
              winbackOn: templates.find((t) => t.key === "winback")?.autoSend ?? false,
              jobs: JOBS.map((j) => ({ name: j.name, label: j.label })),
              runs: runs.filter((r) => r.day === today).map((r) => ({ name: r.name, startedAt: r.startedAt, result: r.result as Record<string, unknown> | null, error: r.error, finishedAt: r.finishedAt })),
            }),
          };
        })()
      : null;
  const privacy =
    tab === "privacy"
      ? await (async () => {
          const [settings, consent, requests, options] = await Promise.all([getPrivacySettings(u.orgId), countConsented(u), listPrivacyRequests(u), memberOptions(u)]);
          return { settings, consent, requests, options, notice: renderNotice(settings, gym.name) };
        })()
      : null;
  const trainerCode = tab === "gym" ? (await db.organization.findUniqueOrThrow({ where: { id: u.orgId }, select: { trainerCode: true } })).trainerCode : null;
  const integrations =
    tab === "int"
      ? await (async () => {
          const [ai, devices] = await Promise.all([getAiSettings(u.orgId), db.device.findMany({ where: { orgId: u.orgId, approved: true, branchId: { in: u.branchIds } }, orderBy: { createdAt: "asc" } })]);
          const now = new Date();
          const branchName = (id: string | null) => branches.find((b) => b.id === id)?.name ?? "—";
          return {
            ai,
            devices: devices.map((d) => ({ id: d.id, name: `${d.name ?? d.serial} · ${branchName(d.branchId)}`, status: deviceStatusText(d, now) })),
            posters: branches.filter((b) => u.branchIds.includes(b.id)).map((b) => ({ id: b.id, name: `Front desk QR poster · ${b.name}`, status: "Active" })),
          };
        })()
      : null;

  return (
    <div className="flex flex-col gap-7 pt-4">
      <div>
        <div className="text-[11px] tracking-[0.1em] text-muted uppercase">{u.role}</div>
        <h1 className="mt-1 text-[28px] lg:text-[40px]">Settings</h1>
      </div>
      <div className="-mb-7">
        <SectionTabs u={u} tabs={SETTINGS_TABS} ruled current={tab === "gym" ? "/settings" : `/settings?tab=${tab}`} />
      </div>
      {typeof sp.saved === "string" && <Notice tone="ok">Saved. Changes are recorded in the audit log.</Notice>}
      {typeof sp.msg === "string" && <Notice tone="ok">{sp.msg}</Notice>}
      {typeof sp.error === "string" && !sp.branch && <Notice tone="alert">{sp.error}</Notice>}
      {tab === "gym" && (
        <div className="grid max-w-[960px] gap-10 lg:grid-cols-2">
          <Panel className="lg:col-span-2">
            <form action={saveGym} className="flex flex-col gap-[18px]">
              <div className="grid max-w-[900px] gap-x-6 gap-y-[18px] sm:grid-cols-2 lg:grid-cols-3">
                <Field label="Gym name">
                  <Input name="name" defaultValue={gym.name} required maxLength={120} />
                </Field>
                <Field label="Tagline">
                  <Input name="tagline" defaultValue={gym.tagline ?? ""} placeholder="Built Stronger" maxLength={80} />
                </Field>
                <Field label="Address">
                  <Textarea name="address" defaultValue={gym.address ?? ""} rows={1} className="h-9 min-h-0! resize-y py-[7px]" maxLength={300} />
                </Field>
                <Field label="State">
                  <Input name="state" defaultValue={gym.state ?? ""} placeholder="Jharkhand" maxLength={60} />
                </Field>
                <Field label="Phone">
                  <Input name="phone" type="tel" inputMode="numeric" defaultValue={gym.phone ?? ""} placeholder="10-digit mobile" />
                </Field>
                <Field label="Email">
                  <Input name="email" type="email" defaultValue={gym.email ?? ""} placeholder="hello@yourgym.in" maxLength={120} />
                </Field>
                <Field label="Website">
                  <Input name="website" defaultValue={gym.website ?? ""} placeholder="yourgym.in" maxLength={120} />
                </Field>
                <Field label="Instagram">
                  <Input name="instagram" defaultValue={gym.instagram ?? ""} placeholder="@yourgym" maxLength={80} />
                </Field>
              </div>
              <div>
                <Button variant="primary">Save</Button>
              </div>
              <p className="text-xs text-muted">
                Saved changes are recorded in the audit log. The name, address and GSTIN print on every invoice; the name is also used in WhatsApp messages and Fitron AI.
              </p>
            </form>
            <LogoForm logoSrc={gymLogoUrl(gym.logoKey)} hasLogo={!!gym.logoKey} />
          </Panel>
          <Panel title="Numbering">
            <form action={saveNumbering} className="flex flex-col gap-3">
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Member ID prefix">
                  <Input name="memberPrefix" defaultValue={numbering?.memberPrefix ?? "FT-"} />
                </Field>
                <Field label="Invoice prefix">
                  <Input name="invoicePrefix" defaultValue={numbering?.invoicePrefix ?? "INV-"} />
                </Field>
                <Field label="Payment prefix">
                  <Input name="paymentPrefix" defaultValue={numbering?.paymentPrefix ?? "PAY-"} />
                </Field>
              </div>
              <p className="text-xs text-muted">Numbers keep counting from where they are; only the prefix changes.</p>
              <div>
                <Button variant="primary">Save</Button>
              </div>
            </form>
          </Panel>
          <Panel title="AI Trainer · Gym Partnership">
            {trainerCode ? (
              <>
                <p className="text-sm">
                  Your gym&apos;s trainer code is <strong className="font-mono text-lg tracking-wider">{trainerCode}</strong>. Members type it into the FITRON AI Trainer (or open{" "}
                  <a className="underline" href={`${appUrl()}/trainer?gym=${trainerCode}`} target="_blank" rel="noopener">
                    {appUrl()}/trainer?gym={trainerCode}
                  </a>
                  ) to link to your gym.
                </p>
                <p className="text-xs text-muted">
                  You see their training next to their membership and earn {Math.round(PARTNER_SHARE * 100)}% of what they pay FITRON for the AI Trainer, before GST. <Link className="underline" href="/partnership">Open Gym Partnership</Link>.
                </p>
              </>
            ) : (
              <form action={makeTrainerCode} className="flex flex-col gap-3">
                <p className="text-sm text-muted">Make a code your members type into the FITRON AI Trainer to link to your gym. You then see their training here and earn {Math.round(PARTNER_SHARE * 100)}% of what they pay FITRON for it, before GST.</p>
                <div>
                  <Button variant="primary">Make our trainer code</Button>
                </div>
              </form>
            )}
          </Panel>
        </div>
      )}
      {tab === "billing" && (
        <div className="max-w-[720px]">
          <Panel>
            <TaxForm tax={tax} invoicePrefix={numbering?.invoicePrefix ?? "INV-"} nextNumber={nextInvoice} />
          </Panel>
        </div>
      )}
      {tab === "reminders" && reminders && (
        <div className="flex max-w-[720px] flex-col gap-[22px]">
          {!u.has("whatsapp") && <Notice>Automatic WhatsApp reminders are on the Professional plan. Default membership duration and the grace period apply on every plan.</Notice>}
          <form action={saveReminders} className="flex flex-col gap-[22px]">
            <div>
              <h4 className="mb-2 text-lg">Expiry reminders</h4>
              <div className="flex flex-wrap gap-2">
                {EXPIRY_CHIPS.map((d) => (
                  <label key={d}>
                    <input type="checkbox" name="expiryDays" value={d} defaultChecked={reminders.settings.expiryDays.includes(d)} className="peer sr-only" />
                    <span className="inline-block cursor-pointer rounded-md border border-line px-3 py-[7px] text-[13px] leading-[normal] peer-checked:border-accent peer-checked:bg-accent peer-checked:text-accent-ink peer-focus-visible:ring-2">
                      {expiryChipLabel(d)}
                    </span>
                  </label>
                ))}
              </div>
            </div>
            <div className="grid gap-x-6 gap-y-[18px] [grid-template-columns:repeat(auto-fill,minmax(220px,1fr))]">
              <Field label="Don’t repeat a reminder within (days)" hint="The same reminder is never sent to a member twice inside this window.">
                <Input name="dedupDays" type="number" min={0} max={30} required defaultValue={reminders.settings.dedupDays} />
              </Field>
              <Field label="Payment due reminder every (days)" hint="0 = off. Sent while an invoice is overdue.">
                <Input name="dueEveryDays" type="number" min={0} max={30} required defaultValue={reminders.settings.dueEveryDays} />
              </Field>
              <Field label="Default membership duration (months)" hint="Pre-selects the plan of this length when selling, and the length of a new plan.">
                <Input name="defaultMonths" type="number" min={1} max={60} required defaultValue={reminders.settings.defaultMonths} />
              </Field>
              <Field label="Grace period after expiry (days)" hint="Expired members may still check in for this many days. The same number is under Check-in devices › Door access rules.">
                <Input name="graceDays" type="number" min={0} max={60} required defaultValue={reminders.graceDays} />
              </Field>
            </div>
            <label className="flex items-center gap-2.5 text-[15px]">
              <input type="checkbox" name="birthdays" defaultChecked={reminders.settings.birthdays} className="size-[18px] accent-accent" />
              Send birthday wishes automatically
            </label>
            <div>
              <Button variant="primary">Save</Button>
            </div>
            <p className="text-xs text-muted">
              Changes are recorded in the audit log. Reminders go out from the daily jobs each morning using the WhatsApp templates (
              <Link href="/whatsapp/templates" className="underline">
                Edit templates
              </Link>
              ).
            </p>
          </form>
          <form action={saveReports} className="flex flex-col gap-2.5">
            <h4 className="text-lg">Reports by email</h4>
            {!u.has("accounting") && <Notice>The monthly profit and loss is part of Accounting, on the Professional plan.</Notice>}
            <label className="flex items-center gap-2.5 text-[15px]">
              <input type="checkbox" name="monthlyPl" defaultChecked={reminders.monthlyPl} disabled={!u.has("accounting")} className="size-[18px] accent-accent" />
              Email last month’s profit and loss to the Super Admins on the 1st
            </label>
            <p className="m-0 pl-7 text-xs text-muted">Revenue, expenses and the net result, with the statement attached as an Excel file. Goes to every active Super Admin who has an email address.</p>
            {u.has("accounting") && (
              <div>
                <Button variant="primary">Save</Button>
              </div>
            )}
          </form>
          <div>
            <h4 className="mb-2 text-lg">Scheduled jobs</h4>
            {reminders.jobs.map((j, i) => (
              <div key={i} className="flex justify-between gap-3 border-b border-line py-[7px] text-sm">
                <span>{j.k}</span>
                <span className="text-right text-muted">{j.v}</span>
              </div>
            ))}
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <LinkButton href="/settings/jobs">Daily jobs</LinkButton>
              <span className="text-xs text-muted">Run them now or see past days under Daily jobs.</span>
            </div>
          </div>
        </div>
      )}
      {tab === "wa" && (
        <div className="flex max-w-[760px] flex-col gap-7">
          {!u.has("whatsapp") && <Notice>Automatic WhatsApp messages are on the Professional plan.</Notice>}
          <LinkedCard wa={wa} cloud={wa.mode === "cloud" && cloudInfo ? { number: waStatus.number ?? cloudInfo.number, name: waStatus.name ?? cloudInfo.name } : null} canUse={u.has("whatsapp")} />
          <p className="m-0 text-[13px] text-muted">
            Quiet hours {fmtClock(wa.quietFrom)} – {fmtClock(wa.quietTo)} ·{" "}
            <Link href="/whatsapp" className="underline">
              change them from Edit rule on any template
            </Link>
          </p>
          <Panel id="whatsapp">
            <form action={saveWhatsApp} className="flex flex-col gap-3 text-sm">
              <Field label="Sending mode" className="max-w-[420px]">
                <Select name="mode" key={wa.mode} defaultValue={wa.mode === "demo" ? "connector" : wa.mode}>
                  <option value="cloud">WhatsApp Business (official, Meta)</option>
                  <option value="connector">Linked gym phone (connector)</option>
                </Select>
              </Field>
              <p className={waStatus.ok ? "text-ok" : "text-alert"}>{waStatus.text}</p>
              {templateStatus && (
                <div className="flex flex-col gap-1 text-[13px]" data-testid="wa-templates">
                  <span>
                    Message templates with Meta: <strong className="text-ok">{templateStatus.approved} approved</strong>
                    {templateStatus.pending > 0 && <>, {templateStatus.pending} waiting for approval</>}
                    {templateStatus.rejected > 0 && <span className="text-alert">, {templateStatus.rejected} rejected</span>}
                  </span>
                  {templateStatus.pending > 0 && <span className="text-xs text-muted">A message can only go out once its template is approved, which usually takes a few minutes and sometimes a day.</span>}
                  {templateStatus.list
                    .filter((t) => t.status === "REJECTED")
                    .map((t) => (
                      <span key={t.name} className="text-xs text-alert">
                        {t.name}: {t.reason ?? "rejected"}
                      </span>
                    ))}
                  {cloudInfo && cloudInfo.templates.some((t) => !t.ok) && <span className="text-xs text-alert">{cloudInfo.templates.filter((t) => !t.ok).length} templates could not be submitted: {cloudInfo.templates.find((t) => !t.ok)?.error}</span>}
                </div>
              )}
              <p className="text-xs text-muted">
                Reminder days, cadence and birthday wishes are under{" "}
                <Link href="/settings?tab=reminders" className="underline">
                  Settings › Reminders
                </Link>
                .
              </p>
              <div className="flex flex-wrap gap-2">
                <Button variant="primary">Save</Button>
                <Link href="/whatsapp/templates" className="inline-flex min-h-10 items-center rounded-md border border-line px-4">
                  Edit templates
                </Link>
              </div>
            </form>
            {wa.mode === "cloud" && cloudInfo && (
              <form action={resubmitTemplatesAction}>
                <Button disabled={!u.has("whatsapp")} title="Send the message templates to Meta again">
                  Resubmit templates to Meta
                </Button>
              </form>
            )}
          </Panel>
          {sp.link === "1" && u.has("whatsapp") && (
            <Dialog kicker="WhatsApp" title="Link WhatsApp" close="/settings?tab=wa" width={600}>
              {meta ? <CloudConnect appId={meta.appId} configId={meta.configId} version={meta.version} /> : <LinkWatcher envMessage={providerReady("connector")} address={connectorAddress()} hosted={providerReady("connector") === HOSTED_NEEDS_CONNECTOR} />}
              <div className="flex flex-wrap justify-end gap-2.5">
                <LinkButton href="/settings?tab=wa" scroll={false}>
                  Cancel
                </LinkButton>
              </div>
            </Dialog>
          )}
        </div>
      )}
      {tab === "int" && integrations && (
        <div className="flex max-w-[900px] flex-col gap-6">
          <Panel title="UPI autopay" id="autopay" small>
            <form action={saveAutopay} className="flex flex-col gap-[18px] text-sm">
              <div className="grid gap-x-6 gap-y-[18px] [grid-template-columns:repeat(auto-fill,minmax(min(100%,240px),1fr))]">
                <Field label="Mode" className="col-span-full max-w-[520px]">
                  <Select name="mode" key={autopay.mode} defaultValue={autopay.mode}>
                    <option value="demo">Demo — simulated inside Fitron</option>
                    <option value="live">Live — Razorpay UPI Autopay</option>
                  </Select>
                </Field>
                <Field label="Autopay provider">
                  <Input value="Razorpay UPI Autopay" disabled readOnly aria-label="Autopay provider" />
                </Field>
                <Field label="Retries on failure">
                  <Input name="retries" type="number" min={1} max={10} step={1} required defaultValue={autopay.retries} />
                </Field>
                <Field label="Days between retries">
                  <Input name="retryGap" type="number" min={1} max={30} step={1} required defaultValue={autopay.retryGap} />
                </Field>
              </div>
              <p className="text-muted">Existing mandates keep the mode they were created in.</p>
              <div className="flex flex-wrap gap-2">
                <Button variant="primary">Save</Button>
                <Link href="/settings/jobs" className="inline-flex min-h-10 items-center rounded-md border border-line px-4">
                  Daily jobs
                </Link>
              </div>
            </form>
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <form action={testAutopayConnection}>
                <Button disabled={!u.has("autopay")} title={u.has("autopay") ? undefined : "UPI autopay is on the Professional plan."}>
                  <PlugsIcon size={16} weight="duotone" />
                  Test connection
                </Button>
              </form>
              <span className={autopay.mode === "live" && autopay.connOk === false ? "text-alert" : autopay.mode === "live" && autopay.connOk ? "text-ok" : "text-muted"} data-testid="autopay-status">
                {autopayStatusText(autopay, autopay.mode)}
              </span>
            </div>
            <p className="max-w-[720px] text-[13px] leading-[1.6] text-muted">
              Live mode uses your own Razorpay account: set RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET and RAZORPAY_WEBHOOK_SECRET on the server and add /api/webhooks/razorpay as a webhook in the Razorpay dashboard. Members approve once in any UPI
              app; Razorpay sends the NPCI pre-debit notice, charges on the renewal date and retries; Fitron records each renewal automatically.
            </p>
          </Panel>
          <Panel title="Check-in devices" id="devices" small>
            <div className="flex flex-col text-sm">
              {integrations.devices.length === 0 && <p className="m-0 mb-2 text-muted">No biometric or QR device yet — front-desk check-in works without one.</p>}
              {[...integrations.devices, ...integrations.posters].map((d) => (
                <div key={d.id} className="flex items-center justify-between gap-3 border-b border-fg/8 py-[7px]">
                  <span>{d.name}</span>
                  <span className="text-right text-muted">{d.status}</span>
                </div>
              ))}
            </div>
            {canOpen(u, "/settings/devices") && (
              <div>
                <Link href="/settings/devices" className="text-sm text-accent underline">
                  Manage devices
                </Link>
              </div>
            )}
          </Panel>
          <Panel title="Fitron AI" id="ai" small>
            {!u.has("ai") && (
              <Notice>
                Fitron AI is on the Professional plan.{" "}
                <Link href="/settings/billing?upgrade=ai" className="font-semibold underline">
                  See plans
                </Link>
              </Notice>
            )}
            <form action={saveAi} className="flex flex-col gap-2.5 text-[15px]">
              <label className="flex items-center gap-2.5">
                <input type="checkbox" name="enabled" defaultChecked={integrations.ai.enabled} disabled={!u.has("ai")} className="size-[18px] accent-accent" />
                Enable Fitron AI assistant
              </label>
              <label className="flex items-center gap-2.5">
                <input type="checkbox" name="dailyBrief" defaultChecked={integrations.ai.dailyBrief} disabled={!u.has("ai")} className="size-[18px] accent-accent" />
                Show the daily brief on the dashboard
              </label>
              <div>
                <label className="flex items-center gap-2.5">
                  <input type="checkbox" name="autoWinback" defaultChecked={integrations.ai.autoWinback} disabled={!u.has("ai")} className="size-[18px] accent-accent" />
                  Suggest win-back messages for members at risk
                </label>
                <p className="m-0 mt-1 pl-7 text-xs text-muted">Drafts a win-back message for staff to confirm. Automatic sending is set per template in WhatsApp › Templates.</p>
              </div>
              <p className="m-0 text-[13px] text-muted">Fitron AI reads data only for the branch and role you are signed in with. It never sends a message or records money without a staff member confirming.</p>
              {u.has("ai") && (
                <div>
                  <Button variant="primary">Save</Button>
                </div>
              )}
            </form>
          </Panel>
        </div>
      )}
      {tab === "privacy" && privacy && (
        <div className="flex max-w-[860px] flex-col gap-7">
          <p className="m-0 text-[13px] text-muted">Built to support the Digital Personal Data Protection Act, 2023. This is a working template, not legal advice. Have a lawyer review it before you publish it.</p>
          <Panel title="Grievance Officer">
            <p className="m-0 text-[13px] text-muted">Members contact this person about their data. Shown in the privacy notice and member messages.</p>
            <form action={savePrivacyOfficer} className="flex flex-col gap-[18px]">
              <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(100%,220px),1fr))]">
                <Field label="Grievance Officer name">
                  <Input name="officer" defaultValue={privacy.settings.officer ?? ""} placeholder="Full name" maxLength={120} />
                </Field>
                <Field label="Grievance email">
                  <Input name="email" type="email" defaultValue={privacy.settings.email ?? ""} placeholder="privacy@yourgym.in" />
                </Field>
                <Field label="Grievance phone">
                  <Input name="phone" type="tel" inputMode="numeric" defaultValue={privacy.settings.phone ?? ""} placeholder="10-digit number" />
                </Field>
                <Field label="Keep data after membership ends (months)" hint="0 keeps data until you erase it by hand.">
                  <Input name="retainMonths" type="number" min={0} max={120} defaultValue={privacy.settings.retainMonths} placeholder="24" />
                </Field>
              </div>
              <div>
                <Button variant="primary">Save</Button>
              </div>
            </form>
          </Panel>
          <Panel title="Member rights requests">
            <p className="m-0 text-[13px] text-muted">
              {privacy.consent.consented} of {privacy.consent.total} members have given consent. Respond to requests within the time your policy promises.
            </p>
            <PrivacyRequestForms options={privacy.options.map((o) => ({ id: o.id, label: o.label }))} />
            {privacy.requests.length > 0 && (
              <div className="flex flex-col">
                {privacy.requests.map((r) => (
                  <div key={r.id} className="flex justify-between gap-3 border-b border-line py-1.5 text-[13px]">
                    <span>
                      {fmtStamp(r.at)} · {r.type} · {r.who}
                    </span>
                    <span className="text-accent">{r.status}</span>
                  </div>
                ))}
              </div>
            )}
          </Panel>
          <Panel title="Privacy notice" id="privacy-policy">
            <p className="m-0 text-xs text-muted">Last updated {fmtDate(privacy.settings.noticeUpdatedAt ?? todayIso())}</p>
            <form action={savePrivacyNotice} className="flex flex-col gap-[18px]">
              {privacy.notice.map((n) => (
                <div key={n.key} className="flex flex-col gap-1.5">
                  <h4 id={`notice-${n.key}`} className="m-0 text-base font-semibold">
                    {n.title}
                  </h4>
                  <Textarea name={`n_${n.key}`} aria-labelledby={`notice-${n.key}`} rows={3} maxLength={2000} defaultValue={n.text} />
                </div>
              ))}
              <div className="flex flex-col gap-1.5">
                <h4 className="m-0 text-base font-semibold">Grievance Officer</h4>
                {privacy.settings.officer || privacy.settings.email || privacy.settings.phone ? (
                  <p className="m-0 text-sm">{[privacy.settings.officer, privacy.settings.email, privacy.settings.phone].filter(Boolean).join(" · ")}</p>
                ) : (
                  <p className="m-0 text-sm text-muted">Not set yet — fill in the Grievance Officer above.</p>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="primary">Save notice</Button>
                <ConfirmButton variant="ghost" type="submit" name="reset" value="1" confirm="Replace your edited notice with Fitron's template?">
                  Reset to template
                </ConfirmButton>
              </div>
            </form>
          </Panel>
          <Panel title="Cookie and storage notice" id="cookie-policy">
            <form action={saveCookieNotice} className="flex flex-col gap-[18px]">
              <Textarea name="cookieNotice" aria-label="Cookie and storage notice" rows={4} maxLength={1000} defaultValue={privacy.settings.cookieNotice} />
              <div>
                <Button variant="primary">Save</Button>
              </div>
            </form>
            <div>
              <ChangeCookieChoice />
            </div>
          </Panel>
        </div>
      )}
      {tab === "help" && <HelpTab u={u} waStatus={waStatus} waMode={wa.mode} />}
      {tab === "branches" && <BranchesTab u={u} sp={sp} />}
    </div>
  );
}

/** The prototype's "Linked WhatsApp" card: the paired number with Send test / Unlink, or a Link WhatsApp button. */
function LinkedCard({ wa, cloud, canUse }: { wa: Awaited<ReturnType<typeof getWaSettings>>; cloud: { number: string; name: string } | null; canUse: boolean }) {
  const linked = wa.linked;
  const at = linked?.at ? new Date(linked.at) : null;
  return (
    <section className="flex max-w-[760px] flex-col gap-2.5 rounded-lg bg-surface px-5 py-[18px]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <WhatsappLogoIcon size={28} weight="duotone" className="text-accent" />
          <div>
            <div className="font-semibold">Linked WhatsApp</div>
            {linked || cloud ? (
              <div className="text-[13px]">
                {linked ? `+91 ${linked.number}` : cloud!.number} · <span className="text-accent">Connected</span>
                <span className="block text-xs text-muted">{linked ? `${linked.device} · linked ${at && !Number.isNaN(at.getTime()) ? `${fmtShort(at)}, ${fmtTime(at)}` : "—"}` : `WhatsApp Business · ${cloud!.name}`}</span>
              </div>
            ) : (
              <div className="text-[13px] text-muted">Not connected yet · link your own WhatsApp in about 5 minutes</div>
            )}
          </div>
        </div>
        {linked || cloud ? (
          <div className="flex gap-1">
            <form action={sendTestAction}>
              <Button disabled={!canUse}>
                <PaperPlaneTiltIcon size={16} weight="duotone" />
                Send test
              </Button>
            </form>
            {(linked || cloud) && (
              <form action={unlinkAction}>
                <ConfirmButton variant="ghost" className="text-alert hover:bg-alert-soft" confirm="Unlink WhatsApp? Automatic sending stops. Messages are saved but not sent until you link again." disabled={!canUse}>
                  {cloud ? "Disconnect" : "Unlink"}
                </ConfirmButton>
              </form>
            )}
          </div>
        ) : (
          <LinkButton href={canUse ? "/settings?tab=wa&link=1" : "/settings/billing?upgrade=whatsapp"} variant="primary" scroll={false}>
            <QrCodeIcon size={16} weight="duotone" />
            Link WhatsApp
          </LinkButton>
        )}
      </div>
      <div className="text-[13px] leading-relaxed">
        Connect your own WhatsApp Business number once. Fitron then sends reminders, invoices and renewals to your members from it by itself at the scheduled time. Your members don&apos;t need to connect anything.
      </div>
      <div className="text-xs leading-relaxed text-muted">This uses WhatsApp&apos;s official business service from Meta. Messages that start a conversation use templates Meta approves first, and Meta charges per conversation. Use it for your own members only.</div>
    </section>
  );
}

/** One settings section: a heading over its form, as in the prototype. */
function Panel({ title, id, className, small, children }: { title?: string; id?: string; className?: string; small?: boolean; children: React.ReactNode }) {
  return (
    <section id={id} className={`flex scroll-mt-20 flex-col gap-3 ${className ?? ""}`}>
      {title && <h3 className={small ? "text-lg" : "text-xl"}>{title}</h3>}
      {children}
    </section>
  );
}
