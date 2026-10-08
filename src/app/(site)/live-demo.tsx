"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// The live demos of the website's product pages (public/site/gym-demo.html and coach-demo.html, self-contained prototypes) in
// place of a screenshot, like the product cards on the home page (public/site/fitron-page.js, site_patches.py). The picture
// shows until the play button; the demo is then drawn at its own design width and scaled to fit, and "Full screen" shows it at
// full size. Phones go straight to full screen, and browsers without the Fullscreen API open the demo in a new tab.

const DEMOS = {
  // The Gym Accounting console, drawn at desktop width.
  gym: {
    src: "/site/gym-demo.html",
    width: 1280,
    title: "FITRON Gym Accounting live demo",
    play: "Try the live demo",
    hint: "Click around a working console with demo data",
    opening: "Opening the demo console…",
    open: "Open the live demo",
  },
  // The AI Coach: the member app, drawn at phone width, in a phone-shaped frame.
  coach: {
    src: "/site/coach-demo.html",
    width: 392,
    title: "FITRON AI Coach live demo",
    play: "Chat with the AI coach",
    hint: "Ask it anything, live",
    opening: "Opening the AI coach…",
    open: "Open the AI coach demo",
  },
  // The whole member app (the same file), opened on its home screen: every tab works, with a made-up member's data.
  app: {
    src: "/site/coach-demo.html#home",
    width: 392,
    title: "FITRON AI Trainer live demo app",
    play: "Open the live demo app",
    hint: "Every screen works, with a sample member",
    opening: "Opening the AI Trainer…",
    open: "Open the AI Trainer demo",
  },
} as const;
export type DemoKind = keyof typeof DEMOS;

const SESSION_KEY = "fitron-session-v1"; // the gym demo's own sign-in, kept in this browser by the demo itself

/** Opens the gym demo signed in as the demo gym's owner, as if they had used the demo login on its sign-in page. */
function seedDemoSession() {
  try {
    if (localStorage.getItem(SESSION_KEY)) return;
    const d = new Date();
    const p2 = (n: number) => String(n).padStart(2, "0");
    const at = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
    localStorage.setItem(SESSION_KEY, JSON.stringify({ name: "Sumit Kumar", email: "sumit@powerhausgym.in", provider: "password", role: "Super Admin", at, photo: "" }));
  } catch {
    // Storage blocked: the demo opens on its sign-in page instead.
  }
}

const toolBtn =
  "inline-flex min-h-9 items-center gap-2 rounded-full border border-line bg-black/80 px-3 text-xs font-semibold text-fg backdrop-blur hover:border-accent focus-visible:border-accent";

export function LiveDemo({ kind = "gym", poster, srcSet, sizes, alt, width, height }: { kind?: DemoKind; poster: string; srcSet?: string; sizes?: string; alt: string; width: number; height: number }) {
  const { src: SRC, width: W, title, play: playText, hint, opening, open } = DEMOS[kind];
  const box = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [started, setStarted] = useState(false);
  const [ready, setReady] = useState(false);
  const [full, setFull] = useState(false);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    const onFull = () => setFull(document.fullscreenElement === el);
    document.addEventListener("fullscreenchange", onFull);
    return () => {
      ro.disconnect();
      document.removeEventListener("fullscreenchange", onFull);
    };
  }, []);

  // Show the demo once it has drawn itself (its loader shows a blank page first).
  useEffect(() => {
    if (!started) return;
    let waited = 0;
    const t = setInterval(() => {
      waited += 300;
      let drawn = false;
      try {
        drawn = (frame.current?.contentDocument?.body?.innerText.length ?? 0) > 80;
      } catch {
        drawn = true;
      }
      if (drawn || waited > 20000) {
        clearInterval(t);
        setReady(true);
      }
    }, 300);
    return () => clearInterval(t);
  }, [started]);

  const start = useCallback(() => {
    if (kind === "gym") seedDemoSession();
    setStarted(true);
  }, [kind]);

  const toggleFull = useCallback(() => {
    const el = box.current;
    if (!el) return;
    if (!document.fullscreenEnabled) {
      window.open(SRC, "_blank", "noopener");
      return;
    }
    if (document.fullscreenElement === el) {
      void document.exitFullscreen();
      return;
    }
    // Ask for full screen inside the click, then load the demo into it.
    el.requestFullscreen().catch(() => window.open(SRC, "_blank", "noopener"));
    start();
  }, [start, SRC]);

  const play = () => {
    // On a phone the scaled console is too small to use, so it opens at full size straight away.
    if (window.innerWidth < 760) toggleFull();
    else start();
  };

  const scale = size.w ? size.w / W : 0.5;
  const frameStyle = full ? { width: "100%", height: "100%" } : { width: W, height: size.h ? size.h / scale : 832, transform: `scale(${scale})`, transformOrigin: "0 0" };

  return (
    <div ref={box} className={`relative isolate overflow-hidden bg-bg ${full ? "h-full w-full" : ""}`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- a static file of the home page, already optimised */}
      <img
        src={poster}
        srcSet={srcSet}
        sizes={srcSet ? (sizes ?? "(min-width: 768px) 768px, 100vw") : undefined}
        width={width}
        height={height}
        alt={alt}
        loading="lazy"
        decoding="async"
        className={`block h-auto w-full transition-opacity duration-500 ${ready ? "opacity-0" : ""} ${full ? "hidden" : ""}`}
      />
      {started && (
        <iframe
          ref={frame}
          src={SRC}
          title={title}
          allow="fullscreen"
          className={`absolute top-0 left-0 border-0 bg-bg transition-opacity duration-500 ${ready ? "opacity-100" : "opacity-0"}`}
          style={frameStyle}
        />
      )}
      {started && !ready && <div className="absolute inset-0 z-10 grid place-items-center bg-black/50 text-sm font-semibold text-accent">{opening}</div>}
      {!started && (
        <button
          type="button"
          onClick={play}
          className="group absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black/35 p-4 text-center text-fg hover:bg-black/45"
        >
          <span className="grid size-16 place-items-center rounded-full bg-accent text-accent-ink shadow-lg transition-transform group-hover:scale-110">
            <svg viewBox="0 0 24 24" className="ml-1 size-7 fill-current" aria-hidden="true">
              <path d="M8 5.5v13l10.5-6.5z" />
            </svg>
          </span>
          <span className="rounded-lg border border-line bg-black/70 px-4 py-2 font-semibold">
            {playText}
            <span className="mt-0.5 block text-xs font-normal text-muted max-sm:hidden">{hint}</span>
          </span>
        </button>
      )}
      <div className={`absolute z-20 flex gap-1.5 ${full ? "top-1/2 right-2 -translate-y-1/2 flex-col opacity-60 hover:opacity-100 focus-within:opacity-100" : "right-2.5 bottom-2.5"}`}>
        <button type="button" onClick={toggleFull} className={toolBtn} aria-label={full ? "Exit full screen" : `${open} full screen`}>
          <svg viewBox="0 0 24 24" className="size-4 fill-none stroke-current stroke-2" aria-hidden="true">
            <path d={full ? "M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" : "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"} />
          </svg>
          {!full && <span>Full screen</span>}
        </button>
        <a href={SRC} target="_blank" rel="noopener" className={toolBtn} aria-label={`${open} in a new tab`}>
          <svg viewBox="0 0 24 24" className="size-4 fill-none stroke-current stroke-2" aria-hidden="true">
            <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
          </svg>
        </a>
      </div>
    </div>
  );
}
