import Link from "next/link";
import { redirect } from "next/navigation";
import { CheckCircleIcon, CurrencyInrIcon, MinusIcon, PencilSimpleIcon, ShieldCheckIcon, ShieldSlashIcon, UserMinusIcon, UserPlusIcon } from "@phosphor-icons/react/dist/ssr";
import { requireUser, upgradePath } from "@/lib/auth/current";
import { listRoles, listStaff } from "@/lib/services/staff";
import { payrollOverview } from "@/lib/services/payroll";
import { Button, Empty, LinkButton, Notice, Select, TABLE, TD, TH, TR, cx, ScrollRegion } from "@/components/ui";
import { Dialog } from "@/components/dialog";
import { AutoFilter } from "@/components/auto-filter";
import { Tag } from "@/components/tag";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { fmtDate, fmtMonthShort, fmtStamp, formatRupees, initials } from "@/lib/format";
import { monthLabel } from "@/lib/domain/periods";
import { payrollMonths, salaryLabel } from "@/lib/domain/payroll";
import { todayIso } from "@/lib/services/time";
import { resetStaffTwoStep, toggleStaff } from "./actions";
import { ConfirmButton } from "@/components/confirm-button";
import { AdvanceForm, PayForm, SalaryForm } from "./payroll-forms";

export const metadata = { title: "Staff & roles · Fitron" };

const rupeeText = (paise: number) => String(paise / 100);

export default async function StaffPage({ searchParams }: PageProps<"/staff">) {
  const u = await requireUser();
  if (!u.can("staff.manage") && !u.can("payroll.manage")) redirect("/dashboard?denied=1");
  if (!u.has("staff")) redirect(upgradePath(u, "staff"));
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const canStaff = u.can("staff.manage");
  const canPay = u.can("payroll.manage");
  const [staff, roles] = await Promise.all([listStaff(u), listRoles()]);
  const active = staff.filter((s) => s.active);
  const allowed = [canStaff && "team", canPay && "pay", canStaff && "perm"].filter(Boolean) as string[];
  const tab = allowed.includes(one("tab") ?? (canStaff ? "team" : "")) ? (one("tab") ?? "team") : allowed[0]!;
  const tabs = ([["team", `Team (${active.length})`, "/staff"], ["pay", "Salary & payroll", "/staff?tab=pay"], ["perm", "Permissions", "/staff?tab=perm"]] as const).filter(([k]) => allowed.includes(k));
  const payroll = active.filter((s) => s.role.name !== "Super Admin").reduce((t, s) => t + s.salary, 0);
  const error = one("error");
  const ok = one("ok");
  const doing = one("do");
  const target = one("id");
  const months = payrollMonths(todayIso());
  const month = months.includes(one("month") ?? "") ? one("month")! : months[0]!;
  const base = tab === "pay" ? `/staff?tab=pay${month !== months[0] ? `&month=${month}` : ""}` : tab === "perm" ? "/staff?tab=perm" : "/staff";
  const sep = base.includes("?") ? "&" : "?";
  const tabQ = tab === "pay" ? "pay" : "";
  const overview = tab === "pay" && canPay ? await payrollOverview(u, month) : null;
  const person = target ? staff.find((s) => s.id === target && s.active && s.role.name !== "Super Admin") : undefined;
  const paidAlready = overview && person ? overview.rows.find((r) => r.id === person.id)?.paid : null;
  const payRow = overview && person ? overview.rows.find((r) => r.id === person.id) : undefined;
  return (
    <div className="flex flex-col gap-6 pt-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-[11px] tracking-[0.12em] text-accent uppercase">Team</div>
          <h1 className="mt-1 text-[28px] lg:text-[40px]">Staff &amp; roles</h1>
          <div className="mt-1 text-sm text-muted">
            {active.length} people · {new Set(active.map((s) => s.role.name)).size} roles · payroll {formatRupees(payroll)}/month
          </div>
        </div>
        {canStaff && (
          <LinkButton href="/staff/new" variant="primary">
            <UserPlusIcon size={17} weight="duotone" />
            Add staff
          </LinkButton>
        )}
      </div>
      {error && <Notice tone="alert">{error}</Notice>}
      {ok && <Notice tone="ok">{ok}</Notice>}
      <nav aria-label="Staff sections" className="flex gap-0.5 overflow-x-auto border-b border-line">
        {tabs.map(([k, label, href]) => (
          <Link key={k} href={href} className={cx("-mb-px flex-none border-b-2 px-3.5 py-2.5 text-[15px] whitespace-nowrap", k === tab ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg")}>
            {label}
          </Link>
        ))}
      </nav>

      {tab === "team" && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,280px),1fr))] gap-3.5">
          {staff.map((s) => (
            <div key={s.id} className={cx("flex flex-col gap-3.5 rounded-lg border bg-surface p-[18px]", s.active ? "border-transparent" : "border-dashed border-line")}>
              <div className="flex items-center gap-3">
                <span className="grid size-11 flex-none place-items-center rounded-full bg-accent-soft font-semibold text-accent">{initials(s.name)}</span>
                <div className="min-w-0 flex-1">
                  <div className={cx("truncate text-base font-semibold", !s.active && "text-muted")}>{s.name}</div>
                  <div className="text-xs text-muted">{s.lastLoginAt ? `Last active: ${fmtStamp(s.lastLoginAt)}` : "Last active: —"}</div>
                </div>
                {s.active ? <span className="rounded-sm border border-accent-500 bg-accent-soft px-2.5 py-[3px] text-[11px] whitespace-nowrap text-accent-strong">{s.role.name}</span> : <Tag label="Deactivated" />}
              </div>
              <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[13px]">
                <span className="text-muted">Branch</span>
                <span>{s.branches.map((b) => b.branch.name).join(", ") || "—"}</span>
                <span className="text-muted">Shift</span>
                <span>{s.shift || "—"}</span>
                <span className="text-muted">Phone</span>
                <span>{s.phone}</span>
                <span className="text-muted">Email</span>
                <span className="truncate">{s.email}</span>
                <span className="text-muted">Salary</span>
                <span>{salaryLabel(s.role.name, s.salary)}</span>
                <span className="text-muted">Two-step</span>
                <span>{s.totpEnabledAt ? "On" : "Off"}</span>
              </div>
              <div className="flex gap-1.5 border-t border-line pt-3">
                <LinkButton href={`/staff/${s.id}/edit`} className="flex-1">
                  <ShieldCheckIcon size={16} weight="duotone" />
                  Change role
                </LinkButton>
                {s.active && s.role.name !== "Super Admin" && (
                  <LinkButton href={`/staff?do=salary&id=${s.id}`} variant="ghost" scroll={false}>
                    <CurrencyInrIcon size={16} weight="duotone" />
                    Salary
                  </LinkButton>
                )}
                {s.id !== u.id && s.totpEnabledAt && (
                  <form action={resetStaffTwoStep.bind(null, s.id)}>
                    <ConfirmButton variant="ghost" confirm={`Turn off two-step sign-in for ${s.name}? They will be signed out everywhere and can set it up again.`} title="Turn off two-step sign-in" aria-label={`Turn off two-step sign-in for ${s.name}`}>
                      <ShieldSlashIcon size={18} weight="duotone" />
                    </ConfirmButton>
                  </form>
                )}
                {s.id !== u.id && (
                  <form action={toggleStaff.bind(null, s.id, !s.active)}>
                    <Button variant="ghost" className={s.active ? "text-alert-700" : undefined} title={s.active ? "Deactivate" : "Reactivate"} aria-label={s.active ? `Deactivate ${s.name}` : `Reactivate ${s.name}`}>
                      {s.active ? <UserMinusIcon size={18} weight="duotone" /> : "Reactivate"}
                    </Button>
                  </form>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "pay" && overview && (
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h3 className="text-[20px]">Salary &amp; payroll</h3>
              <div className="text-[13px] text-muted">Pay salaries, give advances and track commission. Every payment is added to Expenses.</div>
            </div>
            <AutoFilter>
              <input type="hidden" name="tab" value="pay" />
              <Select name="month" defaultValue={month} aria-label="Month" className="w-auto!">
                {months.map((m) => (
                  <option key={m} value={m}>
                    {monthLabel(m)}
                  </option>
                ))}
              </Select>
            </AutoFilter>
          </div>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,180px),1fr))] gap-3">
            {(
              [
                ["Monthly payroll", formatRupees(overview.stats.payroll)],
                [`Paid for ${fmtMonthShort(month)}`, formatRupees(overview.stats.paid)],
                ["Still to pay", `${overview.stats.due} people`],
                ["Advances outstanding", formatRupees(overview.stats.advances)],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="rounded-lg bg-surface px-4 py-3.5">
                <div className="text-xs text-muted">{label}</div>
                <div className="text-[22px] font-semibold">{value}</div>
              </div>
            ))}
          </div>
          {overview.rows.length === 0 ? (
            <Empty>No staff to pay yet. Add your team from the Team tab.</Empty>
          ) : (
            <ScrollRegion label="Team members">
              <table className={cx(TABLE, "min-w-[720px]")}>
                <thead>
                  <tr>
                    <th className={TH}>Staff</th>
                    <th className={TH}>Role</th>
                    <th className={cx(TH, "text-right")}>Monthly salary</th>
                    <th className={TH}>Status</th>
                    <th className={cx(TH, "text-right")}>Net paid</th>
                    <th className={TH}><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {overview.rows.map((r) => (
                    <tr key={r.id} className={TR}>
                      <td className={TD}>
                        <div className="flex items-center gap-2.5">
                          <span className="grid size-[30px] flex-none place-items-center rounded-full bg-bg text-[11px] font-semibold">{initials(r.name)}</span>
                          <div>
                            <div>{r.name}</div>
                            {r.advanceOutstanding > 0 && <div className="text-[11px] text-alert">{formatRupees(r.advanceOutstanding)} advance</div>}
                          </div>
                        </div>
                      </td>
                      <td className={TD}>{r.role.name}</td>
                      <td className={cx(TD, "text-right")}>{r.salary > 0 ? formatRupees(r.salary) : "—"}</td>
                      <td className={TD}>{r.paid ? <Tag label="Paid on">Paid {fmtDate(r.paid.date)}</Tag> : <Tag label="Pending">Due</Tag>}</td>
                      <td className={cx(TD, "text-right")}>{r.paid ? formatRupees(r.paid.net) : "—"}</td>
                      <td className={cx(TD, "text-right")}>
                        <div className="flex justify-end gap-1.5">
                          {!r.paid && (
                            <LinkButton href={`${base}${sep}do=pay&id=${r.id}`} variant="primary" scroll={false}>
                              Pay
                            </LinkButton>
                          )}
                          <LinkButton href={`${base}${sep}do=advance&id=${r.id}`} variant="ghost" scroll={false}>
                            Advance
                          </LinkButton>
                          <LinkButton href={`${base}${sep}do=salary&id=${r.id}`} variant="ghost" scroll={false} title="Salary details" aria-label="Salary details">
                            <PencilSimpleIcon size={16} weight="duotone" />
                          </LinkButton>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollRegion>
          )}
          {overview.history.length > 0 && (
            <div>
              <div className="mb-1 text-sm font-semibold">Recent salary payments</div>
              {overview.history.map((h) => (
                <div key={h.id} className="flex items-start justify-between gap-3 border-b border-line-soft py-2">
                  <div>
                    <div className="text-sm">
                      {fmtDate(h.date)} · {h.user.name} · {h.month ? monthLabel(h.month) : ""}
                    </div>
                    <div className="text-xs text-muted">
                      {[`Base ${formatRupees(h.base)}`, h.commission > 0 && `commission ${formatRupees(h.commission)}`, h.bonus > 0 && `bonus ${formatRupees(h.bonus)}`, h.deductions > 0 && `deductions ${formatRupees(h.deductions)}`, h.advance > 0 && `advance ${formatRupees(h.advance)}`]
                        .filter(Boolean)
                        .join(" + ")
                        .replace(/ \+ deductions/, " − deductions")
                        .replace(/ \+ advance/, " − advance")}
                      {` · ${h.method}`}
                      {h.reference ? ` · ${h.reference}` : ""}
                    </div>
                  </div>
                  <div className="font-semibold">{formatRupees(h.net)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "perm" && !u.has("roles") && (
        <Notice tone="accent">
          Changing what each role can do is on the Enterprise plan. Your roles keep their standard permissions.{" "}
          <Link href="/settings/billing?upgrade=roles" className="font-semibold underline">
            See plans
          </Link>
        </Notice>
      )}
      {tab === "perm" && u.has("roles") && (
        <section>
          <h3 className="mb-1.5 text-[22px]">Permissions</h3>
          <p className="mb-3.5 text-[13px] text-muted">What each role can do. Change a person&apos;s role from Change role.</p>
          <ScrollRegion label="Payroll">
            <table className={cx(TABLE, "min-w-[720px]")}>
              <thead>
                <tr>
                  <th className={TH}>Module / action</th>
                  {roles.map((r) => (
                    <th key={r.id} className={cx(TH, "text-center")}>
                      {r.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(Object.keys(PERMISSIONS) as (keyof typeof PERMISSIONS)[]).map((k) => (
                  <tr key={k} className={TR}>
                    <td className={TD}>{PERMISSIONS[k]}</td>
                    {roles.map((r) => {
                      const has = r.permissions.some((p) => p.permission.key === k);
                      return (
                        <td key={r.id} className={cx(TD, "text-center", has ? "text-accent" : "text-neutral-400")}>
                          {has ? <CheckCircleIcon size={17} weight="duotone" className="inline" aria-label="Yes" /> : <MinusIcon size={17} className="inline" aria-label="No" />}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>
        </section>
      )}

      {person && doing === "salary" && (canPay || canStaff) && (
        <Dialog kicker={person.name} title="Salary details" close={base}>
          <SalaryForm id={person.id} close={base} tab={tabQ} month={month} init={{ salary: person.salary ? rupeeText(person.salary) : "", ptRate: String(person.ptRate), joinedOn: person.joinedOn ? person.joinedOn.toISOString().slice(0, 10) : "", payAccount: person.payAccount ?? "" }} />
        </Dialog>
      )}
      {person && doing === "advance" && canPay && (
        <Dialog kicker={person.name} title="Salary advance" close={base} note="Recorded as a salary expense today and deducted automatically from the next salary.">
          <AdvanceForm id={person.id} close={base} tab={tabQ} month={month} />
        </Dialog>
      )}
      {person && doing === "pay" && canPay && overview && (
        <Dialog kicker={`${person.name} · ${monthLabel(month)}`} title="Pay salary" close={base}>
          {paidAlready ? (
            <Notice tone="accent">
              {person.name} is already paid for {monthLabel(month)}.
            </Notice>
          ) : (
            <PayForm id={person.id} close={base} tab={tabQ} month={month} kind={person.role.name === "Trainer" ? "Trainer" : "Staff"} init={{ base: rupeeText(person.salary), commission: rupeeText(payRow?.commission ?? 0), advance: rupeeText(payRow?.advanceOutstanding ?? 0) }} />
          )}
        </Dialog>
      )}
    </div>
  );
}
