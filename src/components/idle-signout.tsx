"use client";

import { useEffect, useRef, useState } from "react";
import { idleLogout } from "@/app/login/actions";

/**
 * Idle sign-out in the browser (prototype `A.idleInit`): a minute before the limit a toast warns;
 * at the limit the session is ended server-side and the login page says why. The server rule in
 * src/lib/auth/session.ts remains the authority when JavaScript is off.
 */
export function IdleSignout({ minutes }: { minutes: number }) {
  const [warn, setWarn] = useState(false);
  const lastActive = useRef(0);
  const done = useRef(false);

  useEffect(() => {
    if (minutes <= 0) return;
    lastActive.current = Date.now();
    const activity = () => {
      lastActive.current = Date.now();
      setWarn(false);
    };
    const check = () => {
      if (done.current) return;
      const idle = (Date.now() - lastActive.current) / 60_000;
      if (idle >= minutes) {
        done.current = true;
        void idleLogout(minutes);
      } else if (idle >= minutes - 1) setWarn(true);
    };
    const events = ["mousemove", "keydown", "touchstart", "click", "scroll"] as const;
    for (const e of events) window.addEventListener(e, activity, { passive: true });
    const onVisible = () => document.visibilityState === "visible" && check();
    document.addEventListener("visibilitychange", onVisible);
    const t = setInterval(check, 15_000);
    return () => {
      for (const e of events) window.removeEventListener(e, activity);
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(t);
    };
  }, [minutes]);

  if (minutes <= 0 || !warn) return null;
  return (
    <div role="alert" className="fixed bottom-6 left-1/2 z-50 max-w-[calc(100%-32px)] -translate-x-1/2 rounded-md bg-alert-soft px-3.5 py-2.5 text-sm text-alert shadow-lg">
      You will be signed out in a minute for security. Move the mouse or tap to stay signed in.
    </div>
  );
}
