import { requirePermission } from "@/lib/auth/current";
import { IMPORT_KINDS, IMPORTS, type ImportKind } from "@/lib/domain/import";
import { getMigration, getOpening } from "@/lib/services/importer";
import { BankIcon, BarbellIcon, DownloadSimpleIcon, ReceiptIcon, StorefrontIcon, UploadSimpleIcon, UsersThreeIcon, WalletIcon } from "@phosphor-icons/react/dist/ssr";
import type { Icon } from "@phosphor-icons/react";
import { Card, LinkButton, Notice, cx } from "@/components/ui";
import { EXPORT_KINDS, EXPORTS } from "@/lib/services/exports";
import { SettingsShell } from "@/components/section-tabs";
import { fmtStamp } from "@/lib/format";
import { todayIso } from "@/lib/services/time";
import { ImportWizard, OpeningForm, SourceForm } from "./import-forms";

export const metadata = { title: "Migrate & import · Fitron" };

export default async function ImportPage({ searchParams }: PageProps<"/settings/import">) {
  const u = await requirePermission("import.run");
  const { step } = await searchParams;
  const [mig, opening] = await Promise.all([getMigration(u.orgId), getOpening(u.orgId)]);
  const kind = (IMPORT_KINDS as readonly string[]).includes(String(step)) ? (step as ImportKind) : null;
  const branch = u.branch === "ALL" ? null : u.branches.find((b) => b.id === u.branch);
  const exports = EXPORT_KINDS.filter((k) => u.can(EXPORTS[k].perm));
  const steps = [...IMPORT_KINDS.map((k) => [k, IMPORTS[k].label, IMPORTS[k].blurb] as const), ["opening", "Opening balances", "Cash in hand and bank balance on the day you switch, so the cash and bank books start right."] as const];
  const doneCount = steps.filter(([k]) => mig.done?.[k as ImportKind]).length;
  const ICONS = {
    members: UsersThreeIcon,
    payments: ReceiptIcon,
    expenses: WalletIcon,
    products: StorefrontIcon,
    assets: BarbellIcon,
    opening: BankIcon,
  } as Record<string, Icon>;
  return (
    <SettingsShell u={u} current="/settings/import">
      <div className="flex max-w-[960px] flex-col gap-7">
        <div className="flex flex-col gap-2">
          <h4 className="text-[22px]">Switch from another software</h4>
          <p className="max-w-[680px] text-[15px] leading-[1.6] text-neutral-700">
            Bring members, payments, expenses, stock and equipment from your old software or Excel. Export each list as CSV (in Excel: File › Save As › CSV), upload it here, confirm the column match and the data lands in the right place.
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-3.5">
            <SourceForm source={mig.source ?? ""} />
            <div className="text-sm text-neutral-700">
              {doneCount} of {steps.length} steps done · {Math.round((doneCount / steps.length) * 100)}%
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          {steps.map(([k, label, blurb], i) => {
            const done = mig.done?.[k as ImportKind];
            const Ic = ICONS[k]!;
            const open = (kind ?? step) === k;
            return (
              <div key={k} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-4 border-b border-fg/8 py-4">
                <span className={cx("inline-flex size-[34px] items-center justify-center rounded-full border text-sm font-semibold", done ? "border-accent bg-accent text-accent-ink" : open ? "border-accent text-accent" : "border-line")}>{i + 1}</span>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-[17px] font-semibold">
                    <Ic size={18} weight="duotone" className="text-accent" />
                    {label}
                  </div>
                  <div className="mt-0.5 text-[13.5px] leading-[1.5] text-neutral-700">{blurb}</div>
                  {done && (
                    <div className="mt-1 text-[13px] text-accent-700">
                      Done · {k === "opening" ? "set" : `${done.n} imported`} · {fmtStamp(new Date(done.at))}
                    </div>
                  )}
                </div>
                <LinkButton href={`/settings/import?step=${k}`} className="text-[13px]">
                  {k === "opening" ? <BankIcon size={17} weight="duotone" /> : <UploadSimpleIcon size={17} weight="duotone" />}
                  {k === "opening" ? "Set balances" : "Upload CSV"}
                </LinkButton>
              </div>
            );
          })}
        </div>
        {kind && (
          <Card title={IMPORTS[kind].label}>
            {!branch ? (
              <Notice>Pick a branch in the header first. Imported records go to that branch.</Notice>
            ) : (
              <>
                <p className="mb-4 text-sm text-muted">
                  Importing into {branch.name}. Excel users: save the sheet as CSV first. Dates can be 05-08-2026, 05/08/26, 2026-08-05 or 5 Aug 2026.
                  {kind === "payments" && " Only import receipts that aren't already counted in the members sheet's paid amount, or they'll be counted twice."}
                </p>
                <ImportWizard kind={kind} />
              </>
            )}
          </Card>
        )}
        {step === "opening" && (
          <Card title="Opening balances">
            <OpeningForm v={opening} today={todayIso()} />
          </Card>
        )}
        <p className="max-w-[680px] text-[13.5px] leading-[1.6] text-neutral-700">Need help moving? Email support@fitron.in with your export and we&apos;ll do it for you, free, within two working days.</p>
        <section className="flex flex-col gap-2.5">
          <h4 className="mt-4 text-lg">Export all data</h4>
          <p className="text-[13px] text-neutral-700">Everything in the branches you can see, as CSV files that open in Excel. Each download is noted in the audit log.</p>
          {exports.length ? (
            <div className="flex flex-wrap gap-2.5">
              {exports.map((k) => (
                <LinkButton key={k} href={`/settings/export/${k}`} prefetch={false} download>
                  <DownloadSimpleIcon size={17} weight="duotone" />
                  {EXPORTS[k].label}
                </LinkButton>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted">Your role can&apos;t export records.</p>
          )}
        </section>
      </div>
    </SettingsShell>
  );
}
