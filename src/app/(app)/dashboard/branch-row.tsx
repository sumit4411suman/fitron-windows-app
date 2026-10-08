"use client";

import { useTransition, type ReactNode } from "react";
import { switchBranch } from "@/app/(app)/actions";
import { cx } from "@/components/ui";

/** A branch row of the comparison table: opens that branch the way the header switcher does. */
export function BranchRow({ id, name, children, className }: { id: string; name: string; children: ReactNode; className?: string }) {
  const [pending, startTransition] = useTransition();
  const go = () =>
    startTransition(async () => {
      const fd = new FormData();
      fd.set("branch", id);
      await switchBranch(fd);
    });
  return (
    <tr
      role="link"
      tabIndex={0}
      title={"Open " + name}
      aria-busy={pending}
      className={cx(className, "cursor-pointer hover:bg-fg/4", pending && "opacity-60")}
      onClick={go}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          go();
        }
      }}
    >
      {children}
    </tr>
  );
}
