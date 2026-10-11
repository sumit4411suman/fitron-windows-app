import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import { parseMarkdownLite, type Block, type Inline } from "@/lib/domain/markdown-lite";

// Draws Fitron AI's replies: the light formatting the model writes (bold, lists, small tables) and clickable links for
// the app's own paths (/invoices/<id>) and web addresses. Built from the parsed tree as React elements only; no reply
// text is ever handed to the browser as HTML.

function Runs({ c }: { c: Inline[] }) {
  return (
    <>
      {c.map((x, i) => {
        switch (x.t) {
          case "text":
            return <Fragment key={i}>{x.v}</Fragment>;
          case "bold":
            return (
              <strong key={i} className="font-semibold">
                <Runs c={x.c} />
              </strong>
            );
          case "italic":
            return (
              <em key={i}>
                <Runs c={x.c} />
              </em>
            );
          case "code":
            return (
              <code key={i} className="rounded bg-fg/8 px-1 py-px font-mono text-[0.92em]">
                {x.v}
              </code>
            );
          case "link":
            if (x.app && !x.newTab)
              return (
                <Link key={i} href={x.href} className="font-medium underline decoration-current/40 underline-offset-2 hover:decoration-current">
                  {x.label}
                </Link>
              );
            return (
              <a key={i} href={x.href} target="_blank" rel="noopener noreferrer" className="font-medium underline decoration-current/40 underline-offset-2 hover:decoration-current">
                {x.label}
              </a>
            );
        }
      })}
    </>
  );
}

function BlockView({ b }: { b: Block }) {
  switch (b.t) {
    case "p":
      return (
        <p className="whitespace-pre-wrap">
          <Runs c={b.c} />
        </p>
      );
    case "h": {
      const H = (`h${Math.min(b.level + 2, 6)}` as "h3" | "h4" | "h5" | "h6");
      return (
        <H className={b.level <= 2 ? "text-[1.05em] font-semibold" : "font-semibold"}>
          <Runs c={b.c} />
        </H>
      );
    }
    case "ul":
      return (
        <ul className="list-disc space-y-0.5 pl-5">
          {b.items.map((it, i) => (
            <li key={i} className="whitespace-pre-wrap">
              <Runs c={it} />
            </li>
          ))}
        </ul>
      );
    case "ol":
      return (
        <ol start={b.start} className="list-decimal space-y-0.5 pl-5">
          {b.items.map((it, i) => (
            <li key={i} className="whitespace-pre-wrap">
              <Runs c={it} />
            </li>
          ))}
        </ol>
      );
    case "table": {
      const [head, ...body] = b.header ? [b.rows[0]!, ...b.rows.slice(1)] : [null, ...b.rows];
      const cell = "border-b border-line px-2 py-1 align-top";
      return (
        <div className="max-w-full overflow-x-auto">
          <table className="w-max min-w-[40%] border-collapse text-[0.95em]">
            {head && (
              <thead>
                <tr>
                  {head.map((c, i) => (
                    <th key={i} className={`${cell} text-left font-semibold`}>
                      <Runs c={c} />
                    </th>
                  ))}
                </tr>
              </thead>
            )}
            <tbody>
              {body.map((r, i) => (
                <tr key={i}>
                  {r.map((c, j) => (
                    <td key={j} className={cell}>
                      <Runs c={c} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
  }
}

/** A reply as formatted text. Safe to call on every streamed chunk; the text is re-read each time. */
export function MarkdownLite({ text, className }: { text: string; className?: string }): ReactNode {
  const blocks = parseMarkdownLite(text);
  if (!blocks.length) return null;
  return (
    <div className={className ?? "space-y-2"}>
      {blocks.map((b, i) => (
        <BlockView key={i} b={b} />
      ))}
    </div>
  );
}
