"use client";

import { useState } from "react";
import { Input } from "@/components/ui";

export function HelpFaq({ faqs }: { faqs: { q: string; a: string }[] }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  const needle = q.trim().toLowerCase();
  const shown = faqs.map((f, i) => ({ ...f, i })).filter((f) => !needle || f.q.toLowerCase().includes(needle) || f.a.toLowerCase().includes(needle));
  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h3 className="text-lg">Common questions</h3>
        <Input className="w-full max-w-[260px]" placeholder="Search help" aria-label="Search help" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="flex flex-col gap-2.5">
        {shown.length === 0 && <p className="py-3 text-sm text-muted">No questions match. Raise a ticket below.</p>}
        {shown.map((f) => (
          <div key={f.i} className="border-b border-line">
            <button type="button" className="flex w-full items-center justify-between gap-3 py-3 text-left text-[15px]" aria-expanded={open === f.i} onClick={() => setOpen(open === f.i ? null : f.i)}>
              <span>{f.q}</span>
              <span className="text-lg text-accent">{open === f.i ? "−" : "+"}</span>
            </button>
            {open === f.i && <p className="mb-3.5 max-w-[680px] text-sm leading-[1.6] text-neutral-800">{f.a}</p>}
          </div>
        ))}
      </div>
    </section>
  );
}
