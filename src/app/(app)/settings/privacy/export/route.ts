import { NextResponse } from "next/server";
import { getCurrentUser, PLAN_ENDED } from "@/lib/auth/current";
import { exportMemberData, findMemberByCode } from "@/lib/services/privacy";

/** Settings › Privacy & DPDP › Export a member's data: the member's data as a JSON file (audited as member.export). */
export async function GET(req: Request) {
  const u = await getCurrentUser();
  if (!u) return new Response("Sign in first.", { status: 401 });
  if (u.planBlocked) return new Response(PLAN_ENDED, { status: 402 });
  if (!u.can("settings.manage")) return new Response("Not allowed.", { status: 403 });
  const url = new URL(req.url);
  const m = await findMemberByCode(u, url.searchParams.get("member") ?? "");
  if (!m) return NextResponse.redirect(new URL(`/settings?${new URLSearchParams({ tab: "privacy", error: "No member with that ID." })}`, url.origin));
  const { filename, json } = await exportMemberData(u, m.id);
  return new Response(JSON.stringify(json, null, 2), {
    headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "private, no-store" },
  });
}
