import Image from "next/image";
import type { ReactNode } from "react";

/** The sign-in, setup and recovery screens of the Local Edition: no website links, nothing that needs the internet. */
export function LocalAuthShell({ title, lead, children }: { title: string; lead?: string; children: ReactNode }) {
  return (
    <main className="grid min-h-screen grid-cols-[repeat(auto-fit,minmax(min(100%,380px),1fr))]">
      <section className="flex flex-col justify-between gap-10 bg-[#0e0d0a] bg-[radial-gradient(ellipse_at_top_left,rgba(207,169,79,0.18),transparent_60%)] p-10 text-[#f3ede0] print:hidden">
        <div className="block w-[min(100%,340px)]">
          <Image src="/fitron-logo.png" alt="FITRON" width={599} height={218} className="block h-auto w-full" priority />
        </div>
        <div className="max-w-[440px]">
          <p className="mb-3 text-xs tracking-[0.14em] text-[#cfa94f] uppercase">FITRON Gym Accounting · Windows</p>
          <h1 className="mb-3.5 text-[40px] leading-[1.08] font-semibold">Your gym&apos;s books, on this computer.</h1>
          <p className="m-0 text-[15px] text-[#f3ede0]/72">Members, payments, GST invoices, expenses and reports. Works offline; your data stays here.</p>
        </div>
        <p className="m-0 text-xs text-[#f3ede0]/60">Back up regularly from Settings › Backup.</p>
      </section>
      <section className="flex items-center justify-center px-6 py-10">
        <div className="flex w-full max-w-[420px] flex-col gap-[18px]">
          <div>
            <h2 className="text-[28px] font-semibold">{title}</h2>
            {lead && <p className="m-0 text-sm text-neutral-700">{lead}</p>}
          </div>
          {children}
        </div>
      </section>
    </main>
  );
}
