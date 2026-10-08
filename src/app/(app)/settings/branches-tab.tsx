import Link from "next/link";
import { ArrowSquareOutIcon, BuildingsIcon, PencilSimpleIcon, PlusIcon, TrashIcon } from "@phosphor-icons/react/dist/ssr";
import type { CurrentUser } from "@/lib/auth/current";
import { db } from "@/lib/db";
import { Badge, Button, Field, Input, LinkButton } from "@/components/ui";
import { Dialog, DialogButtons } from "@/components/dialog";
import { ConfirmButton } from "@/components/confirm-button";
import { ReasonForm } from "@/components/reason-form";
import { Tag } from "@/components/tag";
import { branchPrice, type Standing } from "@/lib/domain/saas";
import { billingHistory, branchStandings } from "@/lib/services/saas";
import { branchRecordCounts, getSetting } from "@/lib/services/settings";
import { fmtDate, formatInr, formatRupees } from "@/lib/format";
import { fromIso, todayIso, toIso } from "@/lib/services/time";
import { deleteBranchAction, openBranch, saveBranchAction, setBranchActiveAction } from "./actions";

function StandingBadge({ s }: { s: Standing }) {
  if (s.kind === "PAID") return <Badge tone="ok">Paid till {fmtDate(s.until)}</Badge>;
  if (s.kind === "GRACE") return <Badge tone="accent">Grace till {fmtDate(s.readOnlyFrom)}</Badge>;
  if (s.kind === "READ_ONLY") return <Badge tone="alert">Read-only</Badge>;
  return null;
}

/** Settings › Branches: usage, one card per branch (Open / Edit / Close / Delete), paid extras and billing history. */
export async function BranchesTab({ u, sp }: { u: CurrentUser; sp: Record<string, string | string[] | undefined> }) {
  const today = todayIso();
  const canEdit = u.can("settings.manage");
  const [{ branches: standing, freeSlots, terms }, rows, numbering, history] = await Promise.all([
    branchStandings(u.orgId, today),
    db.branch.findMany({ where: { orgId: u.orgId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
    getSetting<{ invoicePrefix?: string }>(u.orgId, "numbering"),
    billingHistory(u),
  ]);
  const ids = rows.map((b) => b.id);
  const live = { orgId: u.orgId, branchId: { in: ids }, deletedAt: null, walkIn: false };
  const [counts, totals, activeNow, staffRows, subs] = await Promise.all([
    branchRecordCounts(u.orgId, ids),
    db.member.groupBy({ by: ["branchId"], where: live, _count: true }),
    db.member.groupBy({ by: ["branchId"], where: { ...live, suspended: false, memberships: { some: { status: "VALID", endDate: { gte: fromIso(today) } } } }, _count: true }),
    db.userBranch.groupBy({ by: ["branchId"], where: { branchId: { in: ids }, user: { active: true, deletedAt: null } }, _count: true }),
    db.branchSubscription.findMany({ where: { orgId: u.orgId, kind: "BRANCH", status: "PAID" }, orderBy: { createdAt: "asc" } }),
  ]);
  const n = (rowsOf: { branchId: string; _count: number }[], id: string) => rowsOf.find((r) => r.branchId === id)?._count ?? 0;
  const stand = new Map(standing.map((s) => [s.id, s.standing]));
  const open = rows.filter((b) => b.active).length;
  const included = terms.includedBranches;
  const used = Math.min(open, included);
  const extra = Math.max(0, open - included);
  const orgPrefix = numbering?.invoicePrefix || "INV-";
  const canAddFree = open < included || freeSlots.length > 0;
  const m = branchPrice("MONTHLY");
  const y = branchPrice("YEARLY");
  const dialog = typeof sp.branch === "string" ? sp.branch : null;
  const editing = dialog && dialog !== "new" ? rows.find((b) => b.id === dialog) : null;
  const err = typeof sp.error === "string" ? sp.error : undefined;
  const here = "/settings?tab=branches";
  const hist = history.filter((h) => h.kind === "BRANCH");
  const sorted = [...rows.filter((b) => b.active), ...rows.filter((b) => !b.active)];

  return (
    <div className="flex max-w-[900px] flex-col gap-3.5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="m-0 max-w-[560px] text-sm">
          Each branch has its own members, invoices, payments, expenses, staff and devices. Plans and WhatsApp templates are shared. The Super Admin sees every branch and the consolidated total; other staff only see their own branch.
        </p>
        {canEdit && (
          <LinkButton variant="primary" href={canAddFree ? `${here}&branch=new` : "/settings/billing#add-branch"}>
            <PlusIcon size={16} /> {canAddFree ? "Add branch" : "Add branch · paid"}
          </LinkButton>
        )}
      </div>

      <div className="max-w-[520px]">
        <div className="text-[13px] font-semibold">
          {used} of {included} included branches used{extra > 0 ? ` · ${extra} extra` : ""}
        </div>
        <div className="my-1.5 h-1.5 overflow-hidden rounded-full bg-fg/10" role="progressbar" aria-label="Included branches used" aria-valuenow={used} aria-valuemin={0} aria-valuemax={included}>
          <div className="h-full rounded-full bg-accent" style={{ width: `${Math.min(100, (used / Math.max(1, included)) * 100)}%` }} />
        </div>
        <div className="text-xs text-muted">
          {!terms.extraBranches
            ? `The ${u.plan.name} plan is for one branch. Move to Enterprise in Settings › Subscription to add more.`
            : open >= included
              ? `Your next branch costs ${formatRupees(m.total)}/month or ${formatRupees(y.total)}/year, GST included.`
              : `${included - open} more branch${included - open === 1 ? "" : "es"} included in your plan at no extra cost.`}
        </div>
      </div>

      {sorted.map((b) => {
        const c = counts.get(b.id)!;
        const s = stand.get(b.id)!;
        const total = n(totals, b.id);
        const hasRecords = c.total > 0;
        const canDel = rows.length > 1;
        const paid = subs.find((x) => x.branchId === b.id && x.periodEnd && toIso(x.periodEnd) >= today);
        return (
          <div key={b.id} className="flex flex-col gap-1.5 rounded-lg bg-surface px-[18px] py-4">
            <div className="flex flex-wrap items-center gap-2.5">
              <BuildingsIcon size={24} className="text-accent" />
              <span className="text-base font-semibold">{b.name}</span>
              {b.active ? <Tag label="Active" /> : <Tag label="Closed" />}
              <StandingBadge s={s} />
              <span className="ml-auto text-[13px]">
                {n(activeNow, b.id)} active of {total} members
              </span>
            </div>
            <div className="text-[13px]">{[b.address, b.phone, b.hours].filter(Boolean).join(" · ")}</div>
            <div className="text-xs text-muted">
              Manager {b.manager || "—"} · {n(staffRows, b.id)} staff · invoice prefix {b.invoicePrefix || orgPrefix}
              {b.gstin ? ` · GSTIN ${b.gstin}` : ""} · opened {fmtDate(toIso(b.createdAt))}
            </div>
            {canEdit && (
              <div className="mt-1 flex flex-wrap items-center gap-2">
                {b.active && (
                  <form action={openBranch.bind(null, b.id)}>
                    <Button variant="ghost">
                      <ArrowSquareOutIcon size={15} /> Open
                    </Button>
                  </form>
                )}
                <LinkButton variant="ghost" href={`${here}&branch=${b.id}`}>
                  <PencilSimpleIcon size={15} /> Edit
                </LinkButton>
                <form action={setBranchActiveAction.bind(null, b.id, !b.active)}>
                  <ConfirmButton
                    variant="ghost"
                    confirm={
                      b.active
                        ? `Close ${b.name}? The branch is hidden from the switcher and new records. Its ${total} members, invoices and payments are kept and still count in consolidated reports.`
                        : `Reopen ${b.name}? The branch appears in the switcher again.`
                    }
                  >
                    {b.active ? "Close branch" : "Reopen"}
                  </ConfirmButton>
                </form>
                {canDel &&
                  (hasRecords ? (
                    b.active ? (
                      <form action={setBranchActiveAction.bind(null, b.id, false)}>
                        <ConfirmButton
                          variant="ghost"
                          className="text-alert-700 hover:bg-alert-soft"
                          confirm={`${b.name} has records. It has ${c.members} members, ${c.invoices} invoices and ${c.expenses} expenses. Financial records can’t be deleted, so close the branch instead: it disappears from the switcher and new records, and its history stays in reports.`}
                        >
                          <TrashIcon size={15} /> Delete
                        </ConfirmButton>
                      </form>
                    ) : (
                      <span className="text-xs text-muted">
                        Can’t be deleted: it has {c.members} members, {c.invoices} invoices and {c.expenses} expenses.
                      </span>
                    )
                  ) : (
                    <ReasonForm
                      compact
                      label="Delete"
                      action={deleteBranchAction.bind(null, b.id)}
                      confirm={`Delete ${b.name}? This branch has no members, invoices or expenses, so it will be removed completely.${paid ? " Its paid branch slot becomes free for a new branch." : ""}`}
                    />
                  ))}
              </div>
            )}
          </div>
        );
      })}

      {subs.length > 0 && (
        <div className="mt-2 flex flex-col gap-2">
          <h3 className="text-base">Extra branches (paid)</h3>
          {subs.map((x) => {
            const end = x.periodEnd ? toIso(x.periodEnd) : null;
            const b = rows.find((r) => r.id === x.branchId);
            const st = !b ? "Not used yet" : stand.get(b.id)?.kind === "GRACE" ? "Grace" : stand.get(b.id)?.kind === "READ_ONLY" ? "Read-only" : end && end >= today ? "Active" : "Read-only";
            const soon = !!b && !!end && Math.round((fromIso(end).getTime() - fromIso(today).getTime()) / 86400000) <= 7;
            return (
              <div key={x.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-line py-2">
                <div>
                  <div className="text-sm font-semibold">{b?.name ?? "Unused slot"}</div>
                  <div className="text-xs text-muted">
                    {formatInr(x.total)} / {x.cycle === "YEARLY" ? "year" : "month"} incl. GST · since {x.periodStart ? fmtDate(toIso(x.periodStart)) : "—"} · renews {end ? fmtDate(end) : "—"} · {st}
                  </div>
                </div>
                {soon && canEdit && (
                  <LinkButton variant="ghost" href="/settings/billing">
                    Renew
                  </LinkButton>
                )}
              </div>
            );
          })}
          {hist.length > 0 && (
            <>
              <h4 className="mt-2 text-[13px] font-semibold">Billing history</h4>
              {hist.map((h) => {
                const line = (
                  <div className="flex items-center justify-between gap-3 border-b border-line py-1.5 text-[13px]">
                    <span>
                      {fmtDate(toIso(h.paidAt ?? h.createdAt))} · Extra branch · {h.cycle === "YEARLY" ? "yearly" : "monthly"} {h.invoiceNo ?? ""} · incl. GST {formatInr(h.gst)}
                    </span>
                    <span>{formatInr(h.total)}</span>
                  </div>
                );
                return h.status === "PAID" ? (
                  <Link key={h.id} href={`/settings/billing/${h.id}`} className="hover:bg-fg/5">
                    {line}
                  </Link>
                ) : (
                  <div key={h.id}>{line}</div>
                );
              })}
            </>
          )}
        </div>
      )}

      {canEdit && dialog && (dialog === "new" || editing) && (
        <Dialog
          kicker="Branches"
          title={editing ? `Edit ${editing.short || editing.name}` : "Add branch"}
          close={here}
          error={err}
          width={560}
          note="Each branch keeps its own members, invoices, payments, expenses, staff and devices. Invoice numbers use this prefix and stay unique across all branches. Plans and WhatsApp templates are shared."
        >
          <form action={saveBranchAction.bind(null, editing?.id ?? null)} className="flex flex-col gap-3.5">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Branch name">
                <Input name="name" defaultValue={editing?.name} placeholder="Sector 12, Bokaro" required />
              </Field>
              <Field label="Short name">
                <Input name="short" defaultValue={editing?.short ?? ""} placeholder="Sector 12" />
              </Field>
              <Field label="Address" className="sm:col-span-2">
                <Input name="address" defaultValue={editing?.address} required />
              </Field>
              <Field label="Phone">
                <Input name="phone" defaultValue={editing?.phone} required />
              </Field>
              <Field label="Branch manager">
                <Input name="manager" defaultValue={editing?.manager ?? ""} />
              </Field>
              <Field label="Opening hours">
                <Input name="hours" defaultValue={editing ? (editing.hours ?? "") : "06:00 – 22:00"} />
              </Field>
              <Field label="Invoice prefix">
                <Input name="invoicePrefix" defaultValue={editing?.invoicePrefix ?? ""} placeholder="PHX-" maxLength={10} />
              </Field>
              <Field label="GSTIN (if separate)">
                <Input name="gstin" defaultValue={editing?.gstin ?? ""} />
              </Field>
            </div>
            <DialogButtons close={here} label={editing ? "Save" : "Add branch"} />
          </form>
        </Dialog>
      )}
    </div>
  );
}
