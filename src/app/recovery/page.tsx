import { notFound, redirect } from "next/navigation";
import { isLocal } from "@/lib/runtime/edition";
import { dataDirs } from "@/lib/runtime/paths";
import { listLocalBackups } from "@/lib/runtime/fitron-backup";
import { readDamage } from "@/lib/runtime/local-damage-marker";
import { Notice } from "@/components/ui";
import { LocalAuthShell } from "@/app/login/local-shell";
import { RecoveryForm, type BackupChoice } from "./recovery-form";

export const metadata = { title: "Recovery · FITRON" };
export const dynamic = "force-dynamic";

const KIND = { auto: "Automatic", manual: "Made by hand", safety: "Safety (before an update or restore)" } as const;
const size = (n: number) => (n > 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

// FITRON for Windows with a damaged database (src/lib/runtime/local-damage.ts): what happened, and a way back from a
// backup. Only while the damage stands; never on fitron.in.
export default async function RecoveryPage() {
  if (!isLocal()) notFound();
  const damage = readDamage();
  if (!damage) redirect("/login");
  const dirs = dataDirs();
  const backups: BackupChoice[] = (await listLocalBackups(dirs)).map((b) => ({
    value: `${b.kind}/${b.name}`,
    label: `${(b.manifest ? new Date(b.manifest.createdAt) : b.modifiedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} · ${KIND[b.kind]}`,
    detail: `${b.name} · ${size(b.size)}${b.encrypted ? " · password-protected" : ""}${b.manifest?.gyms[0] ? ` · ${b.manifest.gyms[0].name}` : ""}`,
    encrypted: b.encrypted,
  }));
  return (
    <LocalAuthShell title="FITRON's database is damaged" lead="FITRON found it damaged when it started (a disk fault, or the computer losing power in the middle of saving), so it will not open or change it.">
      <div className="flex flex-col gap-3 text-sm text-neutral-700" data-testid="damaged">
        <p className="m-0">
          Restore a backup to carry on. The damaged files are not deleted: FITRON moves them aside into the data folder, so FITRON support can still look at
          them for anything entered after the backup.
        </p>
        {damage.problems[0] && <p className="m-0 text-xs text-muted">What SQLite reported: {damage.problems.slice(0, 2).join("; ")}</p>}
      </div>
      {backups.length ? (
        <RecoveryForm backups={backups} />
      ) : (
        <Notice tone="alert">
          There are no backups on this computer. If you have one on a pen drive or another computer, copy the .fitronbackup file into {dirs.backups}\manual, then
          open this page again. Otherwise call FITRON support before doing anything with the data folder.
        </Notice>
      )}
      <p className="m-0 text-xs text-muted">Backups on this computer are in {dirs.backups}. A backup from a pen drive can be copied into its manual folder.</p>
    </LocalAuthShell>
  );
}
