/** The message "Send plan on WhatsApp" sends. {{member_name}} and {{gym_name}} are filled in when it is sent. */
export function planMessage(o: { workout: { name: string; days: { name: string; exercises: { name: string; sets: string }[] }[] } | null; dietName: string | null }): string {
  const w = o.workout ? `${o.workout.name}\n${o.workout.days.map((d) => `${d.name}: ${d.exercises.map((e) => `${e.name} ${e.sets}`).join(", ")}`).join("\n")}` : "";
  return `Hi {{member_name}}, your plan from {{gym_name}}:\n\n${w}${o.dietName ? `\n\nDiet: ${o.dietName}` : ""}`;
}

type Rec = { lift: string; weightKg: number; reps: number; date: string | Date };
const dkey = (d: string | Date) => (typeof d === "string" ? d : d.toISOString().slice(0, 10));

/** The heaviest record per lift (ties go to the latest date), ordered by lift name. */
export function bestRecords<T extends Rec>(rows: T[]): T[] {
  const best = new Map<string, T>();
  for (const r of rows) {
    const b = best.get(r.lift);
    if (!b || r.weightKg > b.weightKg || (r.weightKg === b.weightKg && dkey(r.date) > dkey(b.date))) best.set(r.lift, r);
  }
  return [...best.values()].sort((a, b) => a.lift.localeCompare(b.lift));
}
