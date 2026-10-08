"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CircleNotchIcon, WhatsappLogoIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui";
import { connectCloudAction } from "./actions";

type FB = { init(o: object): void; login(cb: (r: { authResponse?: { code?: string } | null }) => void, o: object): void };
declare global {
  interface Window {
    FB?: FB;
    fbAsyncInit?: () => void;
  }
}

/**
 * Meta's "Connect" pop-up (Embedded Signup). The gym owner logs in to Facebook, picks or creates her WhatsApp Business account
 * and number and verifies it by code; Meta then gives this page a short-lived code and, in a message, the ids of the account
 * and number. Both go to the server, which keeps the gym's own connection. Nothing secret is handled in the browser.
 */
export function CloudConnect({ appId, configId, version }: { appId: string; configId: string; version: string }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [phase, setPhase] = useState<"idle" | "waiting" | "saving">("idle");
  const [error, setError] = useState("");
  const got = useRef<{ code?: string; wabaId?: string; phoneNumberId?: string; sent?: boolean }>({});

  async function finish() {
    const g = got.current;
    if (g.sent || !g.code || !g.wabaId || !g.phoneNumberId) return;
    g.sent = true;
    setPhase("saving");
    const r = await connectCloudAction({ code: g.code, wabaId: g.wabaId, phoneNumberId: g.phoneNumberId }).catch(() => ({ ok: false as const, error: "Something went wrong. Try again." }));
    if (!r.ok) {
      got.current = {};
      setPhase("idle");
      setError(r.error);
      return;
    }
    const note = `WhatsApp connected${r.number ? ` as ${r.number}` : ""}. ${r.submitted} message templates are with Meta for approval, which usually takes a few minutes to a day.${r.warnings.length ? ` Note: ${r.warnings.join("; ")}` : ""}`;
    router.push(`/settings?tab=wa&msg=${encodeURIComponent(note)}`);
    router.refresh();
  }

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== "https://www.facebook.com" && e.origin !== "https://web.facebook.com") return;
      try {
        const d = JSON.parse(String(e.data)) as { type?: string; event?: string; data?: { waba_id?: string; phone_number_id?: string } };
        if (d.type !== "WA_EMBEDDED_SIGNUP") return;
        if (d.event === "FINISH" && d.data) {
          got.current.wabaId = d.data.waba_id;
          got.current.phoneNumberId = d.data.phone_number_id;
          void finish();
        } else if (d.event === "CANCEL") {
          setPhase("idle");
          setError("The connection was cancelled before it finished.");
        }
      } catch {
        // Other messages on the window are not ours.
      }
    };
    window.addEventListener("message", onMessage);
    window.fbAsyncInit = () => {
      window.FB?.init({ appId, autoLogAppEvents: true, xfbml: false, version });
      setReady(true);
    };
    if (window.FB) window.fbAsyncInit();
    else if (!document.getElementById("facebook-jssdk")) {
      const s = document.createElement("script");
      s.id = "facebook-jssdk";
      s.async = true;
      s.src = "https://connect.facebook.net/en_US/sdk.js";
      s.onerror = () => setError("Could not load Meta's connect window. Check the internet connection or an ad blocker, then reload.");
      document.body.appendChild(s);
    }
    return () => window.removeEventListener("message", onMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function start() {
    if (!window.FB) return;
    setError("");
    got.current = {};
    setPhase("waiting");
    window.FB.login(
      (r) => {
        if (r.authResponse?.code) {
          got.current.code = r.authResponse.code;
          void finish();
        } else {
          setPhase("idle");
          setError("The connection was cancelled before it finished.");
        }
      },
      { config_id: configId, response_type: "code", override_default_response_type: true, extras: { setup: {}, featureType: "", sessionInfoVersion: "3" } },
    );
  }

  return (
    <div className="flex flex-col gap-3.5 text-sm leading-relaxed">
      <div className="flex items-start gap-3.5">
        <WhatsappLogoIcon size={30} weight="duotone" className="flex-none text-accent" />
        <div className="flex flex-col gap-1.5">
          <strong>Connect your gym&apos;s WhatsApp Business number</strong>
          <span>A Meta window opens. Sign in with Facebook, pick or create your WhatsApp Business account, and verify the number you want members to hear from by the code Meta sends. Takes about 5 minutes. Fitron then sends reminders, invoices and renewals from your number, to your members only.</span>
          <span className="text-xs text-muted">
            Use a number that is not busy with the normal WhatsApp app. Meta checks and approves your message templates (usually minutes, sometimes a day) and charges you per conversation at its own rates. Members don&apos;t connect anything.
          </span>
        </div>
      </div>
      {error && <span className="text-xs text-alert">{error}</span>}
      <div>
        <Button variant="primary" type="button" onClick={start} disabled={!ready || phase !== "idle"}>
          {phase === "saving" ? (
            <>
              <CircleNotchIcon size={16} className="animate-spin" /> Finishing the connection…
            </>
          ) : phase === "waiting" ? (
            "Finish in the Meta window…"
          ) : (
            "Connect with Meta"
          )}
        </Button>
      </div>
    </div>
  );
}
