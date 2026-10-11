import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/current";
import { Button, Card, Field, Notice, Textarea } from "@/components/ui";
import { SettingsShell } from "@/components/section-tabs";
import { fmtDate } from "@/lib/format";
import { isLocal } from "@/lib/runtime/edition";
import { thisLicence, TRIAL_DAYS, type LicenceStatus } from "@/lib/licence";
import { CopyButton } from "../copy-button";
import { importLicenceAction } from "./actions";

export const metadata = { title: "Licence · Fitron" };

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3 border-b border-line-soft py-[7px] text-[15px]">
      <span>{k}</span>
      <span className="text-right text-muted">{v}</span>
    </div>
  );
}

const days = (n: number) => `${n} day${n === 1 ? "" : "s"}`;

/** The one sentence at the top: where this computer stands and what it means for the desk. */
function headline(s: LicenceStatus): { tone: "ok" | "alert" | "neutral"; text: string } {
  switch (s.kind) {
    case "trial":
      return { tone: s.daysLeft <= 7 ? "alert" : "neutral", text: `Free trial: ${days(s.daysLeft)} left, until ${fmtDate(s.until)}. Everything works; import a licence from FITRON before then.` };
    case "active":
      return { tone: s.daysLeft <= 30 ? "alert" : "ok", text: `Licensed to ${s.licence.licensee} until ${fmtDate(s.licence.expiresOn)}${s.daysLeft <= 30 ? `: renew within ${days(s.daysLeft)}` : ""}.` };
    case "grace":
      return { tone: "alert", text: `The licence ended on ${fmtDate(s.licence.expiresOn)}. Everything keeps working for ${days(s.daysLeft)}, until ${fmtDate(s.graceUntil)}, while the renewal arrives.` };
    case "ended":
      return { tone: "alert", text: `${s.licence ? "The licence" : "The free trial"} has ended, so nothing new can be added. Every record stays readable: collect dues, run reports, export and back up as usual. Import a licence to carry on.` };
    case "wrong-computer":
      return { tone: "alert", text: `The licence on file is for another computer.${s.trial ? ` The free trial carries on for ${days(s.trial.daysLeft)}.` : ""} Send FITRON this computer's installation id for a licence made for it.` };
  }
}

export default async function LicencePage({ searchParams }: PageProps<"/settings/licence">) {
  // Open when the licence has ended: this is where a gym imports the new one.
  const u = await requirePermission("settings.manage", { allowBlocked: true });
  if (!isLocal()) redirect("/settings");
  const sp = await searchParams;
  const view = thisLicence();
  const s = view.status;
  const h = headline(s);
  const l = "licence" in s ? s.licence : null;
  return (
    <SettingsShell u={u} current="/settings/licence">
      <div className="flex max-w-[720px] flex-col gap-[18px]">
        {typeof sp.imported === "string" && <Notice tone="ok">Licence {sp.imported} imported. Thank you.</Notice>}
        {typeof sp.error === "string" && <Notice tone="alert">{sp.error}</Notice>}
        <Notice tone={h.tone}>{h.text}</Notice>
        {view.problem && <Notice tone="alert">The licence file on this computer cannot be used: {view.problem}</Notice>}
        {!view.hasKey && <Notice tone="alert">This copy of FITRON has no licence key built in, so it cannot accept a licence. Install the official FITRON for Windows from FITRON.</Notice>}

        <Card title="This computer">
          <Row k="Status" v={{ trial: "Free trial", active: "Licensed", grace: "Licence ended, grace period", ended: "Ended: nothing new can be added", "wrong-computer": "Licence is for another computer" }[s.kind]} />
          {l && <Row k="Licensed to" v={l.licensee} />}
          {l && <Row k="Licence" v={`${l.licenceId} · ${l.plan}`} />}
          {l && <Row k="Valid" v={`${fmtDate(l.issuedOn)} to ${fmtDate(l.expiresOn)}, then ${days(l.graceDays)} of grace`} />}
          <Row k="Active branches allowed" v={String(s.branches)} />
          <div className="flex flex-wrap items-center justify-between gap-3 py-[7px] text-[15px]">
            <span>Installation id</span>
            <span className="flex items-center gap-2">
              <code className="text-[13px] text-muted">{view.installationId || "made when FITRON first starts"}</code>
              {view.installationId && <CopyButton text={view.installationId} />}
            </span>
          </div>
          <p className="m-0 mt-2 text-[13px] text-muted">
            To get a licence, send FITRON support this installation id. FITRON sends back a licence file. A licence is checked on this computer: nothing is sent anywhere, and it works with no internet. A new installation has a {TRIAL_DAYS}-day free trial.
          </p>
        </Card>

        <Card title="Import a licence">
          <form action={importLicenceAction} className="flex flex-col gap-3.5">
            <Field label="Licence file (.fitronlicence)">
              <input type="file" name="file" accept=".fitronlicence,.txt" className="text-sm" aria-label="Licence file" />
            </Field>
            <Field label="Or paste the licence text">
              <Textarea name="text" rows={3} placeholder="FITRON-LICENCE-1.…" />
            </Field>
            <div>
              <Button variant="primary">Import licence</Button>
            </div>
          </form>
        </Card>
      </div>
    </SettingsShell>
  );
}
