"use client";

import { useEffect, useState } from "react";

export type TocItem = readonly [id: string, label: string];

/** The table of contents of a policy page: beside the text on desktop (it stays in view and marks where you are), a closed list above it on phones. */
export function LegalToc({ items }: { items: readonly TocItem[] }) {
  const [current, setCurrent] = useState<string | null>(null);

  useEffect(() => {
    const targets = items.map(([id]) => document.getElementById(id)).filter((el): el is HTMLElement => !!el);
    if (!("IntersectionObserver" in window)) return;
    const io = new IntersectionObserver(
      (entries) => {
        const seen = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (seen) setCurrent(seen.target.id);
      },
      { rootMargin: "-90px 0px -65% 0px" },
    );
    targets.forEach((t) => io.observe(t));
    return () => io.disconnect();
  }, [items]);

  const list = (
    <ul className="s-toc">
      {items.map(([id, label]) => (
        <li key={id}>
          <a href={`#${id}`} aria-current={current === id ? "true" : undefined}>
            {label}
          </a>
        </li>
      ))}
    </ul>
  );
  return (
    <>
      <details className="s-card mt-8 p-4 lg:hidden">
        <summary className="cursor-pointer font-semibold">On this page</summary>
        <nav aria-label="On this page" className="mt-3">
          {list}
        </nav>
      </details>
      <nav aria-label="On this page" className="sticky top-24 hidden self-start lg:block">
        <p className="s-eyebrow mb-3">On this page</p>
        {list}
      </nav>
    </>
  );
}
