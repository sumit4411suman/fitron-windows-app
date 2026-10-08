"use client";

import { switchBranch } from "@/app/(app)/actions";

export function BranchSwitcher({ branches, value, drawer }: { branches: { id: string; name: string }[]; value: string; drawer?: boolean }) {
  if (branches.length < 2) return null;
  return (
    <form action={switchBranch} className={drawer ? "block" : "hidden sm:block"}>
      <select
        key={value}
        name="branch"
        defaultValue={value}
        aria-label="Branch"
        title="Branch"
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className={`min-h-9 rounded-md ${drawer ? "w-full" : "min-w-[170px]"} border border-line bg-surface px-2.5 text-sm text-fg hover:border-fg/45 focus:border-accent focus:outline-none`}
      >
        {branches.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
        <option value="ALL">All branches (consolidated)</option>
      </select>
    </form>
  );
}
