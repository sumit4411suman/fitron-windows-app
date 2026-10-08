import { requirePermission } from "@/lib/auth/current";
import { goLiveChecklist, installationInfo } from "@/lib/services/go-live";
import { getIdleMinutes } from "@/lib/services/settings";
import { Button, Field, Input, LinkButton, Notice } from "@/components/ui";
import { SettingsShell } from "@/components/section-tabs";
import { Dialog } from "@/components/dialog";
import { CheckCircleIcon, CircleIcon, WarningCircleIcon } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { clearDemo, saveSecurity } from "./actions";

export const metadata = { title: "Go live · Fitron" };

const btn = "inline-flex py-2.5 leading-[1.2] items-center gap-1.5 rounded-md border px-[18px] text-sm font-semibold whitespace-nowrap";

export default async function GoLivePage({ searchParams }: PageProps<"/settings/go-live">) {
  const u = await requirePermission("settings.manage");
  const sp = await searchParams;
  const [list, info, idleMinutes] = await Promise.all([goLiveChecklist(u), installationInfo(u.orgId), getIdleMinutes(u.orgId)]);
  const error = typeof sp.error === "string" ? sp.error : undefined;
  const clearing = sp.clear === "1" && list.items.some((i) => i.key === "demo" && !i.ok);

  return (
    <SettingsShell u={u} current="/settings/go-live">
      {sp.saved === "security" && <Notice tone="ok">Saved. Changes are recorded in the audit log.</Notice>}
      {error && !clearing && <Notice tone="alert">{error}</Notice>}

      <div className="flex max-w-[900px] flex-col gap-[26px]">
        <div className="flex flex-col gap-2">
          <h2 className="text-[22px] font-semibold">Go-live checklist</h2>
          <p className="max-w-[680px] text-[15px] leading-[1.6] text-muted">Everything a gym needs in place before running on Fitron for real. Items marked with a warning are recommended; the rest are required.</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-3.5">
            <div className="h-2 max-w-[360px] flex-[1_1_220px] overflow-hidden rounded-full bg-fg/10" role="progressbar" aria-label="Go-live checklist progress" aria-valuenow={list.pct} aria-valuemin={0} aria-valuemax={100}>
              <div className="h-full rounded-full bg-accent" style={{ width: `${list.pct}%` }} />
            </div>
            <strong className="text-sm">
              {list.done} of {list.total} done
            </strong>
            <span className="text-[13px] text-muted">{list.summary}</span>
          </div>
        </div>

        <ul className="m-0 list-none p-0">
          {list.items.map((i) => (
            <li key={i.key} className="grid grid-cols-[auto_1fr_auto] items-center gap-x-3.5 border-b border-line-soft py-[13px] max-sm:grid-cols-[auto_1fr] max-sm:gap-y-2" data-check={i.key} data-ok={i.ok ? "1" : "0"}>
              <span className="flex" role="img" aria-label={i.ok ? "Done" : i.recommended ? "Recommended" : "Required"}>
                {i.ok ? <CheckCircleIcon size={24} weight="duotone" color="#2e9e63" /> : i.recommended ? <WarningCircleIcon size={24} weight="duotone" className="text-accent-700" /> : <CircleIcon size={24} weight="duotone" className="text-alert-700" />}
              </span>
              <div className="min-w-0">
                <div className="text-[15.5px] font-semibold">{i.label}</div>
                <div className="text-[13px] text-muted">{i.detail}</div>
              </div>
              {i.button && (
                <div className="max-sm:col-start-2">
                  {i.button.href.startsWith("#") ? (
                    <a href={i.button.href} className={`${btn} border-line text-[13px] hover:bg-fg/7`}>
                      {i.button.label}
                    </a>
                  ) : (
                    <LinkButton href={i.button.href} variant={i.button.danger ? "danger" : "default"} className="text-[13px]" scroll={!i.button.danger}>
                      {i.button.label}
                    </LinkButton>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>

        <div className="grid gap-x-10 gap-y-6" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
          <section id="security" className="flex scroll-mt-20 flex-col gap-3">
            <h3 className="text-[17px] font-semibold">Security</h3>
            <form action={saveSecurity} className="flex flex-col gap-3">
              <Field label="Sign staff out after (minutes idle, 0 = never)">
                <Input name="idleMinutes" type="number" min={0} max={1440} step={1} defaultValue={idleMinutes} required className="max-w-[260px]" />
              </Field>
              <div>
                <Button variant="primary">Save</Button>
              </div>
            </form>
            <p className="text-[13px] text-muted">Every sign-in, role change, money entry and export is in the audit log. Passwords are stored hashed; finance screens are limited by role.</p>
          </section>
          <section className="flex flex-col gap-3">
            <h3 className="text-[17px] font-semibold">This installation</h3>
            <div className="text-sm leading-[1.8]">
              <div>
                Fitron version <strong>{info.version}</strong> · fitron.in
              </div>
              <div>
                Data:{" "}
                <strong>
                  {info.members} members · {info.invoices} invoices · {info.payments} payments
                </strong>{" "}
                on the server · files in {info.storage}
              </div>
              <div>
                Support:{" "}
                <a href="mailto:support@fitron.in" className="text-accent underline">
                  support@fitron.in
                </a>
              </div>
            </div>
          </section>
        </div>
      </div>

      {clearing && (
        <Dialog kicker="Go live" title="Clear demo data and go live?" close="/settings/go-live" error={error} width={520}>
          <p className="m-0 text-sm">All demo members, payments, expenses, leads, classes and products are removed. Your gym profile, plans, branches, staff, templates and settings are kept. Download a backup first if you want the demo data.</p>
          <p className="m-0 text-[13px] text-muted">This gym was created from FITRON&apos;s demo seed (Power Haus Gym), so only this gym&apos;s records are removed; other gyms are never touched. Month locks on demo months are removed with the demo money records.</p>
          <form action={clearDemo} className="flex flex-col gap-3.5">
            <Field label="Type CLEAR DEMO DATA to confirm">
              <Input name="confirm" required autoFocus autoComplete="off" />
            </Field>
            <div className="flex justify-end gap-2.5">
              <Link href="/settings/go-live" className={`${btn} border-line hover:bg-fg/7`} scroll={false}>
                Cancel
              </Link>
              <Button variant="danger">Clear demo data</Button>
            </div>
          </form>
        </Dialog>
      )}
    </SettingsShell>
  );
}
