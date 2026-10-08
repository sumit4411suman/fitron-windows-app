import { getCurrentUser } from "@/lib/auth/current";
import { isFitronAdmin } from "@/lib/integrations/fitron-team";
import { partnerPayouts, trainerMembers, trainerPaymentList, type TrainerListFilter } from "@/lib/services/trainer-admin";
import { toCsv } from "@/lib/services/reports";
import { todayIso } from "@/lib/services/time";
import { findPlan } from "@/lib/domain/pricing";

const stamp = (d: Date | null | undefined) => (d ? d.toISOString() : "");

/** FITRON team only: the AI Trainer's members, payments or a month's gym payouts, as the page shows them. */
export async function GET(req: Request) {
  const u = await getCurrentUser();
  if (!u) return new Response("Sign in first.", { status: 401 });
  if (!isFitronAdmin(u.email)) return new Response("Not allowed.", { status: 403 });
  const sp = new URL(req.url).searchParams;
  const what = sp.get("what") ?? "members";
  const today = todayIso();
  let csv: string;
  if (what === "payments") {
    const { rows } = await trainerPaymentList({ status: sp.get("status") ?? "", page: 1, pageSize: 500 });
    csv = toCsv({
      columns: [
        { key: "started", label: "Started" },
        { key: "member", label: "Member" },
        { key: "email", label: "Email" },
        { key: "gym", label: "Gym" },
        { key: "what", label: "Plan" },
        { key: "kind", label: "Kind" },
        { key: "ref", label: "Ref" },
        { key: "base", label: "Before GST (Rs)" },
        { key: "gst", label: "GST (Rs)" },
        { key: "total", label: "Total (Rs)" },
        { key: "couponCode", label: "Coupon" },
        { key: "mode", label: "Mode" },
        { key: "status", label: "Status" },
        { key: "paidAt", label: "Paid" },
        { key: "periodStart", label: "Period from" },
        { key: "periodEnd", label: "Period to" },
      ],
      rows: rows.map((p) => ({ ...p, started: stamp(p.createdAt), createdAt: stamp(p.createdAt), paidAt: stamp(p.paidAt), base: p.base / 100, gst: p.gst / 100, total: p.total / 100, gym: p.gym ?? "", couponCode: p.couponCode ?? "", periodStart: p.periodStart ?? "", periodEnd: p.periodEnd ?? "" })),
    });
  } else if (what === "payouts") {
    const m = sp.get("month") ?? "";
    const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(m) ? m : today.slice(0, 7);
    const { rows } = await partnerPayouts(month);
    csv = toCsv({
      columns: [
        { key: "month", label: "Month" },
        { key: "gym", label: "Gym" },
        { key: "code", label: "Trainer code" },
        { key: "members", label: "Linked members" },
        { key: "payments", label: "Payments" },
        { key: "base", label: "Before GST (Rs)" },
        { key: "share", label: "Owed to the gym (Rs)" },
      ],
      rows: rows.map((r) => ({ month, gym: r.gym, code: r.code ?? "", members: r.members, payments: r.payments, base: r.base / 100, share: r.share / 100 })),
    });
  } else {
    const status = (sp.get("status") ?? "") as TrainerListFilter["status"];
    const { rows } = await trainerMembers({ q: sp.get("q") ?? "", status, page: 1, pageSize: 200 }, today);
    csv = toCsv({
      columns: [
        { key: "name", label: "Name" },
        { key: "email", label: "Email" },
        { key: "plan", label: "Plan" },
        { key: "cycle", label: "Cycle" },
        { key: "access", label: "Access" },
        { key: "paidUntil", label: "Paid until" },
        { key: "trialEndsAt", label: "Trial ends" },
        { key: "planCancelled", label: "Not renewing" },
        { key: "onboarded", label: "Onboarded" },
        { key: "signupVia", label: "Signed up with" },
        { key: "gym", label: "Gym" },
        { key: "gymCode", label: "Member ID at gym" },
        { key: "createdAt", label: "Joined" },
        { key: "lastSeenAt", label: "Last seen" },
        { key: "lifetime", label: "Paid in all (Rs)" },
      ],
      rows: rows.map((m) => ({ ...m, plan: findPlan(m.plan)?.name ?? m.plan, paidUntil: m.paidUntil ?? "", trialEndsAt: m.trialEndsAt ?? "", planCancelled: m.planCancelled ? "yes" : "", onboarded: m.onboarded ? "yes" : "no", gym: m.gym ?? "", gymCode: m.gymCode ?? "", createdAt: stamp(m.createdAt), lastSeenAt: stamp(m.lastSeenAt), lifetime: m.lifetime / 100 })),
    });
  }
  return new Response("﻿" + csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="fitron-ai-trainer-${what}-${today}.csv"` } });
}
