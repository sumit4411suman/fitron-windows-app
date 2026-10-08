"use client";

/** A role dropdown that opens the "Confirm with your password" dialog by going to ?change=…&role=…; the Change button covers no-JS. */
export function RolePicker({ userId, roleId, roles, disabled, title }: { userId: string; roleId: string; roles: { id: string; name: string }[]; disabled?: boolean; title?: string }) {
  return (
    <form method="get" action="/settings/roles" className="flex items-center gap-2">
      <input type="hidden" name="change" value={userId} />
      <select
        name="role"
        aria-label="Role"
        title={title}
        defaultValue={roleId}
        disabled={disabled}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="min-h-9 min-w-[170px] rounded-md border border-line bg-surface px-2.5 text-sm text-fg hover:border-fg/45 focus:border-accent focus:outline-none disabled:opacity-60"
      >
        {roles.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </select>
      <noscript>
        <button className="rounded-md border border-line px-2.5 py-1.5 text-sm">Change</button>
      </noscript>
    </form>
  );
}
