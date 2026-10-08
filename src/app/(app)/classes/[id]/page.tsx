import { redirect } from "next/navigation";
import { weekStart } from "@/lib/services/classes";

/** Sessions open in the timetable's panel; this keeps old links working. */
export default async function ClassSession({ params, searchParams }: PageProps<"/classes/[id]">) {
  const { id } = await params;
  const { date } = await searchParams;
  const d = typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
  redirect(`/classes?${new URLSearchParams({ ...(d ? { week: weekStart(d), date: d } : {}), sel: id })}#session`);
}
