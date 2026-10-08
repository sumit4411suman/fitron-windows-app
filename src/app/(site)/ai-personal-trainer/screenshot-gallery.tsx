"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// The app screenshots on /ai-personal-trainer, like an app store's: a row of phone screens that scrolls sideways (arrows on a
// computer, a swipe on a phone), and a press on one opens it full size, with the others a tap or an arrow key away. The
// pictures are public/site/trainer/<id>.webp, taken by scripts/trainer-screenshots.mjs; all are 540 x 1169.

type Shot = { readonly id: string; readonly caption: string; readonly alt: string };

const W = 540;
const H = 1169;
const src = (id: string) => `/site/trainer/${id}.webp`;

const arrow = "grid size-10 place-items-center rounded-full border border-line bg-black/70 text-fg backdrop-blur hover:border-accent focus-visible:border-accent disabled:opacity-0";

function Chevron({ left }: { left?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="size-5 fill-none stroke-current stroke-2" aria-hidden="true">
      <path d={left ? "M15 5l-7 7 7 7" : "M9 5l7 7-7 7"} />
    </svg>
  );
}

export function ScreenshotGallery({ shots }: { shots: readonly Shot[] }) {
  const strip = useRef<HTMLUListElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [edges, setEdges] = useState({ start: true, end: false });

  const onScroll = useCallback(() => {
    const el = strip.current;
    if (!el) return;
    setEdges({ start: el.scrollLeft < 8, end: el.scrollLeft + el.clientWidth > el.scrollWidth - 8 });
  }, []);
  useEffect(onScroll, [onScroll]);

  const page = (dir: 1 | -1) => strip.current?.scrollBy({ left: dir * strip.current.clientWidth * 0.8, behavior: "smooth" });

  const show = (i: number) => {
    setOpen(i);
    if (!dialog.current?.open) dialog.current?.showModal();
  };
  const step = useCallback((dir: 1 | -1) => setOpen((i) => (i === null ? i : (i + dir + shots.length) % shots.length)), [shots.length]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowRight") step(1);
    if (e.key === "ArrowLeft") step(-1);
  };

  const current = open === null ? null : shots[open];

  return (
    <div className="relative">
      <ul ref={strip} onScroll={onScroll} className="flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-smooth pb-3 [scrollbar-width:thin]" aria-label="App screenshots">
        {shots.map((s, i) => (
          <li key={s.id} className="w-[44%] shrink-0 snap-start sm:w-[200px]">
            <button
              type="button"
              onClick={() => show(i)}
              className="block w-full rounded-2xl text-left focus-visible:outline-2 focus-visible:outline-accent"
              aria-label={`${s.caption}: view full size`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- static screenshots, already sized and compressed */}
              <img
                src={src(s.id)}
                width={W}
                height={H}
                alt={s.alt}
                loading={i < 4 ? "eager" : "lazy"}
                decoding="async"
                className="block h-auto w-full rounded-2xl border border-line bg-bg transition-transform hover:-translate-y-0.5"
              />
              <span className="mt-2 block text-sm leading-snug text-muted">{s.caption}</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="pointer-events-none absolute inset-x-0 top-[38%] hidden justify-between px-1 sm:flex">
        <button type="button" onClick={() => page(-1)} disabled={edges.start} className={`${arrow} pointer-events-auto`} aria-label="Earlier screenshots">
          <Chevron left />
        </button>
        <button type="button" onClick={() => page(1)} disabled={edges.end} className={`${arrow} pointer-events-auto`} aria-label="More screenshots">
          <Chevron />
        </button>
      </div>

      <dialog
        ref={dialog}
        onClose={() => setOpen(null)}
        onKeyDown={onKey}
        onClick={(e) => e.target === e.currentTarget && dialog.current?.close()}
        className="m-auto max-h-none max-w-none bg-transparent p-0 text-fg backdrop:bg-black/85"
        aria-label="Screenshot"
      >
        {current && (
          <figure className="flex flex-col items-center gap-3 p-3">
            {/* eslint-disable-next-line @next/next/no-img-element -- the same static screenshot, full size */}
            <img src={src(current.id)} width={W} height={H} alt={current.alt} className="block h-auto max-h-[80vh] w-auto max-w-[92vw] rounded-3xl border border-line" />
            <figcaption className="text-center text-sm font-semibold">
              {current.caption}
              <span className="ml-2 font-normal text-muted">
                {open! + 1} / {shots.length}
              </span>
            </figcaption>
            <div className="flex gap-2">
              <button type="button" onClick={() => step(-1)} className={arrow} aria-label="Previous screenshot">
                <Chevron left />
              </button>
              <button type="button" onClick={() => dialog.current?.close()} className={`${arrow} w-auto px-4 text-sm font-semibold`} autoFocus>
                Close
              </button>
              <button type="button" onClick={() => step(1)} className={arrow} aria-label="Next screenshot">
                <Chevron />
              </button>
            </div>
          </figure>
        )}
      </dialog>
    </div>
  );
}
