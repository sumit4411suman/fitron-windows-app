import { getCurrentUser, PLAN_ENDED } from "@/lib/auth/current";
import { listDay } from "@/lib/services/attendance";
import { toCsv } from "@/lib/services/reports";
import { nowHHMM, todayIso } from "@/lib/services/time";

// The day's check-ins as CSV (prototype: Date, Member ID, Name, Type, Check-in, Check-out, Minutes, Method).
export async function GET(req: Request) {
  const u = await getCurrentUser();
  if (!u) return new Response("Sign in first.", { status: 401 });
  if (u.planBlocked) return new Response(PLAN_ENDED, { status: 402 });
  if (!u.can("attendance.manage") || !u.has("attendance")) return new Response("Not allowed.", { status: 403 });
  const q = new URL(req.url).searchParams.get("date");
  const date = q && /^\d{4}-\d{2}-\d{2}$/.test(q) ? q : todayIso();
  const { rows } = await listDay(u, date);
  const csv = toCsv({
    columns: ["date", "id", "name", "type", "in", "out", "minutes", "method"].map((key, i) => ({ key, label: ["Date", "Member ID", "Name", "Type", "Check-in", "Check-out", "Minutes", "Method"][i]! })),
    rows: rows.map((r) => ({
      date,
      id: r.member?.code ?? "",
      name: r.member?.name ?? r.guestName ?? "",
      type: r.type === "MEMBER" ? "Member" : r.type === "DAY_PASS" ? "Day pass" : r.type === "TRIAL" ? "Trial" : "Guest",
      in: nowHHMM(r.checkIn),
      out: r.checkOut ? nowHHMM(r.checkOut) : "",
      minutes: r.checkOut ? Math.round((r.checkOut.getTime() - r.checkIn.getTime()) / 60000) : null,
      method: r.method,
    })),
  });
  return new Response("﻿" + csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="attendance_${date}.csv"`, "Cache-Control": "private, no-store" } });
}
