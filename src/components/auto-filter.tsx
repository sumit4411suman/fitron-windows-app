"use client";

import { useRef, type ReactNode } from "react";

/** A GET form that applies itself: selects and dates on change, text after a short pause (the prototype filters as you type). */
export function AutoFilter({ children, className }: { children: ReactNode; className?: string }) {
  const form = useRef<HTMLFormElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const submit = () => {
    // A new filter starts from page 1.
    const page = form.current?.querySelector<HTMLInputElement>('input[name="page"]');
    if (page) page.value = "1";
    form.current?.requestSubmit();
  };
  return (
    <form
      ref={form}
      className={className}
      onChange={(e) => {
        const t = e.target as unknown as HTMLInputElement;
        if (t.type === "text" || t.type === "search") {
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(submit, 400);
        } else submit();
      }}
    >
      {children}
    </form>
  );
}
