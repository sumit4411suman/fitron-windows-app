import "server-only";
import { db } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/current";
import type { DietInput, ProgressInput, RecordInput, WorkoutInput } from "@/lib/validation/frontdesk";
import { audit } from "./audit";
import { UserError } from "./errors";
import { memberScope } from "./members";
import { fromIso, toIso } from "./time";

export type WorkoutDay = { name: string; exercises: { name: string; sets: string }[] };
export type Meal = { name: string; food: string };

export async function listWorkouts(u: CurrentUser) {
  const plans = await db.workoutPlan.findMany({ where: { orgId: u.orgId }, orderBy: [{ active: "desc" }, { name: "asc" }], include: { _count: { select: { members: { where: { deletedAt: null } } } } } });
  return plans.map((p) => ({ ...p, days: p.days as WorkoutDay[] }));
}
export async function listDiets(u: CurrentUser) {
  const plans = await db.dietPlan.findMany({ where: { orgId: u.orgId }, orderBy: [{ active: "desc" }, { name: "asc" }], include: { _count: { select: { members: { where: { deletedAt: null } } } } } });
  return plans.map((p) => ({ ...p, meals: p.meals as Meal[] }));
}
export async function getWorkout(u: CurrentUser, id: string) {
  const p = await db.workoutPlan.findFirst({ where: { orgId: u.orgId, id } });
  return p ? { ...p, days: p.days as WorkoutDay[] } : null;
}
export async function getDiet(u: CurrentUser, id: string) {
  const p = await db.dietPlan.findFirst({ where: { orgId: u.orgId, id } });
  return p ? { ...p, meals: p.meals as Meal[] } : null;
}

export async function saveWorkout(u: CurrentUser, id: string | null, input: WorkoutInput) {
  const before = id ? await db.workoutPlan.findFirst({ where: { orgId: u.orgId, id } }) : null;
  if (id && !before) throw new UserError("Plan not found.");
  return db.$transaction(async (tx) => {
    const after = before ? await tx.workoutPlan.update({ where: { id: before.id }, data: input }) : await tx.workoutPlan.create({ data: { ...input, orgId: u.orgId } });
    await audit(tx, { orgId: u.orgId, userId: u.id, action: before ? "workout.update" : "workout.create", entity: "WorkoutPlan", entityId: after.id, before, after });
    return after;
  });
}

export async function saveDiet(u: CurrentUser, id: string | null, input: DietInput) {
  const before = id ? await db.dietPlan.findFirst({ where: { orgId: u.orgId, id } }) : null;
  if (id && !before) throw new UserError("Plan not found.");
  return db.$transaction(async (tx) => {
    const after = before ? await tx.dietPlan.update({ where: { id: before.id }, data: input }) : await tx.dietPlan.create({ data: { ...input, orgId: u.orgId } });
    await audit(tx, { orgId: u.orgId, userId: u.id, action: before ? "diet.update" : "diet.create", entity: "DietPlan", entityId: after.id, before, after });
    return after;
  });
}

export async function setProgramActive(u: CurrentUser, kind: "workout" | "diet", id: string, active: boolean) {
  const r = kind === "workout" ? await db.workoutPlan.updateMany({ where: { orgId: u.orgId, id }, data: { active } }) : await db.dietPlan.updateMany({ where: { orgId: u.orgId, id }, data: { active } });
  if (!r.count) throw new UserError("Plan not found.");
}

/** Assigns (or clears) a member's workout and diet. Trainers can only do this for their own members. */
export async function assignPrograms(u: CurrentUser, memberId: string, a: { trainerId: string | null; workoutPlanId: string | null; dietPlanId: string | null }) {
  const before = await db.member.findFirst({ where: { ...memberScope(u), id: memberId } });
  if (!before) throw new UserError("Member not found.");
  if (a.trainerId && !(await db.user.findFirst({ where: { id: a.trainerId, orgId: u.orgId, deletedAt: null, active: true, role: { name: "Trainer" } }, select: { id: true } }))) throw new UserError("Trainer not found.");
  if (a.workoutPlanId && !(await db.workoutPlan.findFirst({ where: { orgId: u.orgId, id: a.workoutPlanId } }))) throw new UserError("Workout not found.");
  if (a.dietPlanId && !(await db.dietPlan.findFirst({ where: { orgId: u.orgId, id: a.dietPlanId } }))) throw new UserError("Diet not found.");
  await db.$transaction(async (tx) => {
    const after = await tx.member.update({ where: { id: memberId }, data: a });
    await audit(tx, { orgId: u.orgId, userId: u.id, action: "member.programs", entity: "Member", entityId: memberId, before: { trainerId: before.trainerId, workoutPlanId: before.workoutPlanId, dietPlanId: before.dietPlanId }, after: a });
    return after;
  });
}

export async function addProgress(u: CurrentUser, memberId: string, input: ProgressInput) {
  const m = await db.member.findFirst({ where: { ...memberScope(u), id: memberId } });
  if (!m) throw new UserError("Member not found.");
  await db.$transaction(async (tx) => {
    const row = await tx.progressLog.create({ data: { memberId, date: fromIso(input.date), weightKg: input.weightKg ?? null, bodyFat: input.bodyFat ?? null, waistCm: input.waistCm ?? null, notes: input.notes ?? null, createdById: u.id } });
    await audit(tx, { orgId: u.orgId, userId: u.id, action: "member.progress", entity: "ProgressLog", entityId: row.id, after: { memberId, date: input.date, weightKg: input.weightKg ?? null, bodyFat: input.bodyFat ?? null, waistCm: input.waistCm ?? null } });
  });
}

export async function listRecords(memberId: string) {
  const rows = await db.personalRecord.findMany({ where: { memberId }, orderBy: [{ lift: "asc" }, { weightKg: "desc" }, { date: "desc" }] });
  return rows.map((r) => ({ ...r, weightKg: Number(r.weightKg) }));
}

export async function addRecord(u: CurrentUser, memberId: string, input: RecordInput) {
  const m = await db.member.findFirst({ where: { ...memberScope(u), id: memberId }, select: { id: true } });
  if (!m) throw new UserError("Member not found.");
  await db.$transaction(async (tx) => {
    const row = await tx.personalRecord.create({ data: { orgId: u.orgId, memberId, lift: input.lift, weightKg: input.weightKg, reps: input.reps, date: fromIso(input.date), createdById: u.id } });
    await audit(tx, { orgId: u.orgId, userId: u.id, action: "member.pr.add", entity: "PersonalRecord", entityId: row.id, after: { memberId, lift: row.lift, weightKg: Number(row.weightKg), reps: row.reps, date: input.date } });
  });
}

export async function removeRecord(u: CurrentUser, memberId: string, id: string) {
  const m = await db.member.findFirst({ where: { ...memberScope(u), id: memberId }, select: { id: true } });
  const r = m ? await db.personalRecord.findFirst({ where: { id, orgId: u.orgId, memberId } }) : null;
  if (!r) throw new UserError("Record not found.");
  await db.$transaction(async (tx) => {
    await tx.personalRecord.delete({ where: { id } });
    await audit(tx, { orgId: u.orgId, userId: u.id, action: "member.pr.remove", entity: "PersonalRecord", entityId: id, before: { memberId, lift: r.lift, weightKg: Number(r.weightKg), reps: r.reps, date: toIso(r.date) } });
  });
}

export async function progressFor(memberId: string) {
  const rows = await db.progressLog.findMany({ where: { memberId }, orderBy: { date: "desc" }, take: 24 });
  return rows.map((r) => ({ ...r, weightKg: r.weightKg ? Number(r.weightKg) : null, bodyFat: r.bodyFat ? Number(r.bodyFat) : null, waistCm: r.waistCm ? Number(r.waistCm) : null }));
}
