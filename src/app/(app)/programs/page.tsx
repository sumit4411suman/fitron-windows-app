import Link from "next/link";
import { PlusIcon } from "@phosphor-icons/react/dist/ssr";
import { requirePermission } from "@/lib/auth/current";
import { db } from "@/lib/db";
import { listDiets, listWorkouts } from "@/lib/services/programs";
import { memberScope, summarize } from "@/lib/services/members";
import { todayIso, toIso } from "@/lib/services/time";
import { Button, LinkButton, TABLE, TD, TH, TR, cx, ScrollRegion } from "@/components/ui";
import { Tag } from "@/components/tag";
import { fmtDate } from "@/lib/format";
import { toggleProgram } from "./actions";

export const metadata = { title: "Workouts & diet · Fitron" };

const TABS = [
  ["workouts", "Workout plans"],
  ["diets", "Diet plans"],
  ["assign", "Member assignments"],
] as const;

const card = "flex flex-col gap-2 rounded-md bg-surface p-[15px]";
const kicker = "text-[10px] tracking-[0.1em] text-accent uppercase";

export default async function ProgramsPage({ searchParams }: PageProps<"/programs">) {
  const u = await requirePermission("programs.manage");
  const { tab: t } = await searchParams;
  const tab = TABS.some(([k]) => k === t) ? (t as string) : "workouts";
  const [workouts, diets] = await Promise.all([listWorkouts(u), listDiets(u)]);

  return (
    <div className="flex flex-col gap-6 pt-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-[11px] tracking-[0.1em] text-muted uppercase">Trainer library</div>
          <h1 className="mt-1 text-[28px] lg:text-[40px]">Workouts &amp; diet</h1>
        </div>
        {tab !== "assign" && (
          <LinkButton href={`/programs/${tab}/new`} variant="primary">
            <PlusIcon size={16} weight="duotone" />
            {tab === "diets" ? "New diet plan" : "New workout plan"}
          </LinkButton>
        )}
      </div>
      <nav aria-label="Programs sections" className="flex flex-wrap gap-1">
        {TABS.map(([k, label]) => (
          <Link key={k} href={k === "workouts" ? "/programs" : `/programs?tab=${k}`} aria-current={k === tab ? "page" : undefined} className={cx("border-b-2 px-3 py-2 text-[15px]", k === tab ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg")}>
            {label}
          </Link>
        ))}
      </nav>

      {tab === "workouts" && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,300px),1fr))] gap-5">
          {workouts.length === 0 && <p className="text-sm text-muted">No workout plans yet.</p>}
          {workouts.map((w) => (
            <div key={w.id} className={cx(card, !w.active && "opacity-65")}>
              <div className="flex items-center justify-between gap-2">
                <div className={kicker}>
                  {w.goal} · {w.level} · {w.weeks} weeks
                </div>
                {!w.active && <Tag label="Retired" />}
              </div>
              <div className="text-xl leading-[1.2] font-semibold">{w.name}</div>
              {w.days.map((d) => (
                <div key={d.name}>
                  <div className="mt-1 text-[13px] font-semibold">{d.name}</div>
                  {d.exercises.map((x, i) => (
                    <div key={i} className="flex justify-between py-0.5 text-[13px]">
                      <span>{x.name}</span>
                      <span className="text-muted">{x.sets}</span>
                    </div>
                  ))}
                </div>
              ))}
              <div className="mt-auto flex items-center justify-between gap-2 text-[11px] text-fg/50">
                <span>
                  {w._count.members} member{w._count.members === 1 ? "" : "s"} assigned
                </span>
                <span className="flex gap-1">
                  <LinkButton href={`/programs/workouts/${w.id}`} variant="ghost">
                    Edit
                  </LinkButton>
                  <form action={toggleProgram.bind(null, "workout", w.id, !w.active)}>
                    <Button variant="ghost">{w.active ? "Retire" : "Use again"}</Button>
                  </form>
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "diets" && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,320px),1fr))] gap-5">
          {diets.length === 0 && <p className="text-sm text-muted">No diet plans yet.</p>}
          {diets.map((d) => (
            <div key={d.id} className={cx(card, !d.active && "opacity-65")}>
              <div className="flex items-center justify-between gap-2">
                <div className={kicker}>
                  {d.kcal.toLocaleString("en-IN")} kcal · {d.protein} g protein
                </div>
                {!d.active && <Tag label="Retired" />}
              </div>
              <div className="text-xl leading-[1.2] font-semibold">{d.name}</div>
              {d.meals.map((m) => (
                <div key={m.name} className="grid grid-cols-[96px_minmax(0,1fr)] gap-2.5 py-[3px] text-[13px]">
                  <span className="text-muted">{m.name}</span>
                  <span>{m.food}</span>
                </div>
              ))}
              <div className="mt-auto flex items-center justify-between gap-2 text-[11px] text-fg/50">
                <span>
                  {d._count.members} member{d._count.members === 1 ? "" : "s"} assigned
                </span>
                <span className="flex gap-1">
                  <LinkButton href={`/programs/diets/${d.id}`} variant="ghost">
                    Edit
                  </LinkButton>
                  <form action={toggleProgram.bind(null, "diet", d.id, !d.active)}>
                    <Button variant="ghost">{d.active ? "Retire" : "Use again"}</Button>
                  </form>
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "assign" && <Assignments u={u} workouts={workouts} diets={diets} />}
    </div>
  );
}

async function Assignments({ u, workouts, diets }: { u: Awaited<ReturnType<typeof requirePermission>>; workouts: { id: string; name: string }[]; diets: { id: string; name: string }[] }) {
  const today = todayIso();
  const members = await db.member.findMany({
    where: { ...memberScope(u), walkIn: false, suspended: false },
    select: { id: true, code: true, name: true, trainerId: true, workoutPlanId: true, dietPlanId: true },
    orderBy: { name: "asc" },
  });
  const sums = await summarize(members.map((m) => m.id), today);
  const active = members.filter((m) => (sums.get(m.id)!.latestEnd ?? "") >= today);
  const [trainers, visits] = await Promise.all([
    db.user.findMany({ where: { id: { in: [...new Set(active.map((m) => m.trainerId).filter(Boolean) as string[])] } }, select: { id: true, name: true } }),
    db.attendance.groupBy({ by: ["memberId"], where: { memberId: { in: active.map((m) => m.id) } }, _max: { date: true } }),
  ]);
  const tName = new Map(trainers.map((t) => [t.id, t.name]));
  const last = new Map(visits.map((v) => [v.memberId, v._max.date]));
  const wName = new Map(workouts.map((w) => [w.id, w.name]));
  const dName = new Map(diets.map((d) => [d.id, d.name]));
  if (active.length === 0) return <p className="text-sm text-muted">No active members{u.can("members.all") ? "" : " assigned to you"}.</p>;
  return (
    <ScrollRegion label="Programs table">
      <table className={cx(TABLE, "min-w-[860px]")}>
        <thead>
          <tr>
            {["Member", "Plan", "Trainer", "Workout", "Diet", "Last check-in"].map((h) => (
              <th key={h} className={TH}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {active.map((m) => (
            <tr key={m.id} className={TR}>
              <td className={TD}>
                <Link href={`/members/${m.id}?tab=fitness`} className="hover:text-accent">
                  {m.name}
                  <span className="block text-xs text-muted">{m.code}</span>
                </Link>
              </td>
              <td className={TD}>{sums.get(m.id)!.planName ?? "—"}</td>
              <td className={TD}>{(m.trainerId && tName.get(m.trainerId)) || "—"}</td>
              <td className={TD}>{(m.workoutPlanId && wName.get(m.workoutPlanId)) || "—"}</td>
              <td className={TD}>{(m.dietPlanId && dName.get(m.dietPlanId)) || "—"}</td>
              <td className={cx(TD, "whitespace-nowrap")}>{last.get(m.id) ? fmtDate(toIso(last.get(m.id)!)) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollRegion>
  );
}
