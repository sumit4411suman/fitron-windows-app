import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { hasDb, makeGym, pick } from "@/test/db";
import { createMember } from "./members";
import { addProgress, addRecord, assignPrograms, listRecords, progressFor, removeRecord, saveDiet, saveWorkout } from "./programs";
import { sendTemplate } from "./whatsapp";
import { planMessage } from "@/lib/domain/programs";
import { todayIso } from "./time";

describe.skipIf(!hasDb)("Programs, progress and records (database)", () => {
  let gym: Awaited<ReturnType<typeof makeGym>>;
  let admin: Awaited<ReturnType<typeof gym.user>>;
  beforeAll(async () => {
    gym = await makeGym();
    admin = pick(await gym.user("Super Admin"), gym.a.id);
  });
  const mk = (phone: string, trainerId?: string) => createMember(admin, { name: "Prog Person", gender: "Male", phone, source: "Walk-in", tags: [], trainerId });

  it("assigns trainer, workout and diet with an audit trail", async () => {
    const trainer = pick(await gym.user("Trainer"), gym.a.id);
    const m = await mk("9866600001");
    const w = await saveWorkout(admin, null, { name: "PPL", goal: "Strength", level: "Beginner", weeks: 8, days: [{ name: "Day A", exercises: [{ name: "Bench", sets: "4 × 8" }] }] } as never);
    const d = await saveDiet(admin, null, { name: "High protein", kcal: 2200, protein: 140, meals: [{ name: "Breakfast", food: "Eggs" }] } as never);
    await assignPrograms(admin, m.id, { trainerId: trainer.id, workoutPlanId: w.id, dietPlanId: d.id });
    expect(await db.member.findUniqueOrThrow({ where: { id: m.id } })).toMatchObject({ trainerId: trainer.id, workoutPlanId: w.id, dietPlanId: d.id });
    const log = await db.auditLog.findFirstOrThrow({ where: { orgId: gym.org.id, action: "member.programs", entityId: m.id } });
    expect(JSON.stringify(log.after)).toContain(trainer.id);

    const other = await (await makeGym()).user("Trainer");
    await expect(assignPrograms(admin, m.id, { trainerId: other.id, workoutPlanId: null, dietPlanId: null })).rejects.toThrow(/Trainer not found/);
    const desk = await gym.user("Receptionist");
    await expect(assignPrograms(admin, m.id, { trainerId: desk.id, workoutPlanId: null, dietPlanId: null })).rejects.toThrow(/Trainer not found/);

    // The trainer sees their own member only.
    const notMine = await mk("9866600002");
    await expect(assignPrograms(trainer, notMine.id, { trainerId: null, workoutPlanId: w.id, dietPlanId: null })).rejects.toThrow(/Member not found/);
    await assignPrograms(trainer, m.id, { trainerId: trainer.id, workoutPlanId: null, dietPlanId: d.id });
  });

  it("logs progress with an audit row", async () => {
    const m = await mk("9866600003");
    await addProgress(admin, m.id, { date: todayIso(), weightKg: 72.5 });
    const rows = await progressFor(m.id);
    expect(rows[0]!.weightKg).toBe(72.5);
    expect(await db.auditLog.count({ where: { orgId: gym.org.id, action: "member.progress" } })).toBeGreaterThan(0);
  });

  it("adds, lists and removes personal records within scope", async () => {
    const m = await mk("9866600004");
    await addRecord(admin, m.id, { lift: "Bench press", weightKg: 60, reps: 5, date: todayIso() });
    await addRecord(admin, m.id, { lift: "Bench press", weightKg: 65, reps: 1, date: todayIso() });
    const rows = await listRecords(m.id);
    expect(rows.map((r) => r.weightKg)).toEqual([65, 60]);
    const stranger = await (await makeGym()).user("Super Admin");
    await expect(addRecord(stranger, m.id, { lift: "X", weightKg: 1, reps: 1, date: todayIso() })).rejects.toThrow(/not found/);
    await expect(removeRecord(stranger, m.id, rows[0]!.id)).rejects.toThrow(/not found/);
    await removeRecord(admin, m.id, rows[0]!.id);
    expect(await listRecords(m.id)).toHaveLength(1);
    const actions = (await db.auditLog.findMany({ where: { orgId: gym.org.id, entity: "PersonalRecord" } })).map((a) => a.action);
    expect(actions).toContain("member.pr.add");
    expect(actions).toContain("member.pr.remove");
  });

  it("sends the plan as a custom WhatsApp message", async () => {
    const m = await mk("9866600005");
    const body = planMessage({ workout: { name: "PPL", days: [{ name: "Day A", exercises: [{ name: "Bench", sets: "4 × 8" }] }] }, dietName: "High protein" });
    await sendTemplate({ orgId: gym.org.id, memberId: m.id, key: "campaign", userId: admin.id, force: true, body });
    const msg = await db.whatsAppMessage.findFirstOrThrow({ where: { memberId: m.id } });
    expect(msg.templateKey).toBe("campaign");
    expect(msg.body).toContain("PPL");
    expect(msg.body).toContain("Diet: High protein");
    expect(msg.body).toContain(gym.org.name);
    expect(msg.body).not.toContain("{{");
  });
});
