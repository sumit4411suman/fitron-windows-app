import Image from "next/image";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/current";
import { aiOn } from "@/lib/services/ai-settings";
import { aiBrief } from "@/lib/services/ai-local";
import { todayIso } from "@/lib/services/time";
import { log } from "@/lib/log";
import { AiWorkspace } from "./chat";

export const metadata = { title: "Fitron AI · Fitron" };

const longDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

export default async function AiPage() {
  const u = await requirePermission("ai.use");
  if (!(await aiOn(u.orgId))) redirect("/dashboard?ai=off");
  // The brief is a summary above the chat: if it can't be worked out, the page and the chat still open.
  const brief = await aiBrief(u).catch((e) => (log.error("ai_brief.failed", e), []));
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <span className="relative inline-block h-[60px] w-[60px] flex-none rounded-full shadow-[0_0_0_1px_var(--accent-500),0_8px_28px_rgba(207,169,79,0.22)]">
            <Image src="/fitron-mark.png" alt="" width={60} height={60} className="rounded-full" />
          </span>
          <div>
            <div className="text-xs tracking-[0.04em] text-muted uppercase">Your accounting assistant</div>
            <h1 className="mt-1 text-[28px] lg:text-[40px]">Fitron AI</h1>
          </div>
        </div>
        <span className="flex items-center gap-2 rounded-full bg-surface px-3 py-2 text-[13px] text-muted">
          <span className="h-2 w-2 rounded-full bg-[#4ade80] shadow-[0_0_6px_#4ade80]" />
          Reads your live books · saves only after you confirm
        </span>
      </div>
      <AiWorkspace brief={brief} today={longDate(todayIso())} />
    </div>
  );
}
