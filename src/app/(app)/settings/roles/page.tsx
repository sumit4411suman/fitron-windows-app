import Link from "next/link";
import { LockKeyIcon, UserPlusIcon } from "@phosphor-icons/react/dist/ssr";
import { requirePermission } from "@/lib/auth/current";
import { db } from "@/lib/db";
import { listRoles, listStaff } from "@/lib/services/staff";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { initials } from "@/lib/format";
import { Button, Field, Input, LinkButton, Notice } from "@/components/ui";
import { Dialog } from "@/components/dialog";
import { Tag } from "@/components/tag";
import { SettingsShell } from "@/components/section-tabs";
import { changeRole } from "./actions";
import { RolePicker } from "./role-picker";

export const metadata = { title: "Roles & access · Fitron" };

export default async function RolesPage({ searchParams }: PageProps<"/settings/roles">) {
  const u = await requirePermission("staff.manage");
  const sp = await searchParams;
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const [staff, roles, counts] = await Promise.all([
    listStaff(u),
    listRoles(),
    db.user.groupBy({ by: ["roleId"], where: { orgId: u.orgId, active: true, deletedAt: null }, _count: true }),
  ]);
  const total = Object.keys(PERMISSIONS).length;
  const allBranches = new Set(roles.filter((r) => r.permissions.some((p) => p.permission.key === "branches.all")).map((r) => r.id));
  const pickId = str("change");
  const pickRole = roles.find((r) => r.id === str("role"));
  const target = pickId ? staff.find((s) => s.id === pickId) : undefined;
  const dialog = target && pickRole && target.role.id !== pickRole.id && target.id !== u.id ? { target, role: pickRole } : null;
  const error = str("error");
  return (
    <SettingsShell u={u} current="/settings/roles">
      {str("saved") === "role" && <Notice tone="ok">{str("name")} is now {str("role")}.</Notice>}
      {error && !dialog && <Notice tone="alert">{error}</Notice>}
      <div className="flex max-w-[860px] flex-col gap-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <p className="m-0 max-w-[540px] text-sm text-neutral-800">Choose what each person can do. Changing a role asks for your password, and every change is saved in the audit log.</p>
          <LinkButton variant="primary" href="/staff/new?role=Receptionist">
            <UserPlusIcon size={16} /> Give access to someone
          </LinkButton>
        </div>
        <div>
          {staff.map((s) => (
            <div key={s.id} className="flex flex-wrap items-center gap-3 border-b border-line py-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-surface text-xs font-semibold">{initials(s.name)}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  {s.name}
                  {!s.active && <Tag label="Deactivated" />}
                </div>
                <div className="text-xs text-muted">
                  {s.email} · {allBranches.has(s.role.id) ? "All branches" : s.branches.map((b) => b.branch.name).join(", ") || "No branch"}
                </div>
              </div>
              <RolePicker
                userId={s.id}
                roleId={s.role.id}
                roles={roles}
                disabled={!s.active || s.id === u.id}
                title={s.id === u.id ? "You can't change your own role." : undefined}
              />
            </div>
          ))}
        </div>
        <div className="grid gap-2.5 [grid-template-columns:repeat(auto-fill,minmax(180px,1fr))]">
          {roles.map((r) => (
            <div key={r.id} className="rounded-lg bg-surface px-3.5 py-3">
              <div className="text-sm font-semibold">{r.name}</div>
              <div className="text-xs text-muted">
                {counts.find((c) => c.roleId === r.id)?._count ?? 0} {(counts.find((c) => c.roleId === r.id)?._count ?? 0) === 1 ? "person" : "people"} · {r.permissions.length} of {total} permissions
              </div>
            </div>
          ))}
        </div>
        <p className="m-0 text-[13px]">
          What each role can do, permission by permission, is in the{" "}
          <Link href="/staff?tab=perm" className="text-accent underline">
            permissions table
          </Link>
          .
        </p>
      </div>
      {dialog && (
        <Dialog kicker="Roles & access" title="Confirm with your password" close="/settings/roles" error={error}>
          <form action={changeRole} className="flex flex-col gap-3.5">
            <p className="m-0 flex items-center gap-2 text-sm">
              <LockKeyIcon size={18} className="shrink-0 text-accent" />
              Change {dialog.target.name} from {dialog.target.role.name} to {dialog.role.name}?
            </p>
            <input type="hidden" name="userId" value={dialog.target.id} />
            <input type="hidden" name="roleId" value={dialog.role.id} />
            <Field label="Your password">
              <Input name="password" type="password" autoFocus autoComplete="current-password" required />
            </Field>
            <div className="flex justify-end gap-2.5">
              <LinkButton variant="ghost" href="/settings/roles" scroll={false}>
                Cancel
              </LinkButton>
              <Button variant="primary">Change role</Button>
            </div>
          </form>
        </Dialog>
      )}
    </SettingsShell>
  );
}
