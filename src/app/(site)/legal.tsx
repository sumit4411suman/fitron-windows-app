import type { ReactNode } from "react";
import { LegalToc, type TocItem } from "./legal-toc";

/**
 * Long-form policy page: title, last-updated line, a table of contents (sticky beside the text on desktop), then sections
 * with anchor ids. The words of the policies are the pages' own and are not edited here.
 */
export function LegalPage({ title, updated, intro, toc, children, summary }: { title: string; updated: string; intro: ReactNode; toc: readonly TocItem[]; children: ReactNode; summary?: ReactNode }) {
  return (
    <div className="grid gap-x-12 lg:grid-cols-[14rem_minmax(0,1fr)]">
      <header className="lg:col-span-2">
        <nav aria-label="Breadcrumb" className="text-sm text-muted">
          <ol className="flex flex-wrap items-center gap-x-2">
            <li>
              <a href="/" className="hover:text-fg">
                FITRON
              </a>
            </li>
            <li aria-hidden="true">/</li>
            <li aria-current="page">{title}</li>
          </ol>
        </nav>
        <h1 className="mt-5 text-4xl font-semibold sm:text-5xl">{title}</h1>
        <p className="mt-3 text-sm text-muted">Last updated {updated}</p>
      </header>
      <div className="lg:order-2 lg:col-start-2">
        <div className="mt-6 max-w-3xl text-lg text-muted">{intro}</div>
        {summary}
        <div className="mt-10 flex max-w-3xl flex-col gap-10 leading-relaxed [&_a]:text-accent [&_a]:underline [&_h2]:mb-3 [&_h2]:scroll-mt-28 [&_h2]:text-2xl [&_h2]:font-semibold [&_li]:mt-1.5 [&_p]:mt-3 [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:pl-6">
          {children}
        </div>
      </div>
      <div className="lg:order-1 lg:col-start-1 lg:row-start-2 lg:pt-6">
        <LegalToc items={toc} />
      </div>
    </div>
  );
}
