"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CircleNotchIcon, PlugsIcon } from "@phosphor-icons/react";
import { linkStatusAction, type LinkStatus } from "./actions";

type View = LinkStatus["state"] | "checking";

/**
 * The Link WhatsApp dialog's live part: asks the server for the connector's state every few seconds
 * (a bit slower while it is offline), shows the QR code, and moves on once the phone is linked.
 */
export function LinkWatcher({ envMessage, address, hosted }: { envMessage: string | null; address: string; hosted: boolean }) {
  const router = useRouter();
  const [st, setSt] = useState<{ state: View; qr?: string; text: string; problem?: string }>({ state: "checking", text: "" });
  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      let next: LinkStatus;
      try {
        next = await linkStatusAction();
      } catch {
        next = { state: "offline", text: "Waiting for the connector… checking every few seconds" };
      }
      if (stop) return;
      if (next.state === "ready") {
        router.push(`/settings?tab=wa&msg=${encodeURIComponent("WhatsApp linked. Messages now send automatically.")}`);
        router.refresh();
        return;
      }
      setSt(next);
      timer = setTimeout(tick, next.state === "offline" ? 5000 : 2500);
    };
    void tick();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [router]);

  if (hosted)
    return (
      <div className="flex items-start gap-3.5">
        <PlugsIcon size={30} weight="duotone" className="flex-none text-accent" />
        <div className="flex flex-col gap-1.5 text-sm leading-relaxed">
          <strong>One-time setup (Fitron team): run the WhatsApp connector</strong>
          <span>Fitron runs online, so it needs the connector running on an always-on server. One connector serves every gym; each gym owner then links her own WhatsApp here by scanning a QR code.</span>
          <ol className="m-0 list-decimal pl-[18px]">
            <li>
              Run the <code>prototype/connector</code> folder (Docker or Node) on any always-on server, with <code>FITRON_KEY</code> set to a long secret and a persistent folder for <code>session</code>.
            </li>
            <li>
              In Vercel › Environment Variables set <code>WA_CONNECTOR_URL</code> (the server&apos;s https address) and <code>WA_CONNECTOR_KEY</code> (the same secret), then redeploy.
            </li>
            <li>Open this dialog again and scan the QR from WhatsApp › Linked devices on the gym phone.</li>
          </ol>
        </div>
      </div>
    );
  if (st.state === "offline")
    return (
      <div className="flex items-start gap-3.5">
        <PlugsIcon size={30} weight="duotone" className="flex-none text-accent" />
        <div className="flex flex-col gap-1.5 text-sm leading-relaxed">
          <strong>Start WhatsApp on this computer</strong>
          <span>
            Double-click <strong>Start WhatsApp -Windows-.bat</strong> in the Fitron <code>connector</code> folder (Mac: <strong>Start WhatsApp -Mac-.command</strong>). Keep its window open. The QR code appears here by itself, no need to refresh.
          </span>
          <span className="text-xs text-muted">
            Fitron looks for the connector at <code>{address}</code>, which is this computer unless <code>WA_CONNECTOR_URL</code> and <code>WA_CONNECTOR_KEY</code> point to one hosted elsewhere. If Fitron itself is hosted online, host the connector too (see the connector README).
          </span>
          {(envMessage || st.text) && <span className="text-xs text-alert">{envMessage ?? st.text}</span>}
          <span className="text-xs text-muted">Waiting for the connector… checking every few seconds</span>
        </div>
      </div>
    );
  if (st.state === "qr")
    return (
      <div className="flex flex-wrap items-start gap-5">
        <div role="img" aria-label="WhatsApp QR code" style={{ backgroundImage: `url(${st.qr})` }} className="size-[220px] flex-none rounded-lg bg-white bg-[length:92%] bg-center bg-no-repeat" />
        <ol className="m-0 min-w-[200px] flex-1 list-decimal pl-[18px] text-sm leading-[1.7]">
          <li>Open WhatsApp on the gym phone</li>
          <li>
            Tap ⋮ (Android) or Settings (iPhone), then <strong>Linked devices</strong>
          </li>
          <li>
            Tap <strong>Link a device</strong> and scan this code
          </li>
          <li className="text-muted">The code refreshes by itself every few seconds</li>
        </ol>
      </div>
    );
  return (
    <div className="flex flex-col gap-2 py-6 text-sm">
      <div className="flex items-center gap-2.5">
        <CircleNotchIcon size={22} weight="duotone" className="animate-spin text-accent" />
        {st.state === "checking" ? "Connecting to the connector…" : st.text || "Connector is starting WhatsApp…"}
      </div>
      {st.problem && <span className="text-xs text-alert">{st.problem}</span>}
    </div>
  );
}
