import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { addDays } from "@/lib/domain/dates";
import { hasDb, makeGym } from "@/test/db";
import { createLead, setLeadStage, touchLead } from "./leads";
import { fromIso, todayIso } from "./time";

describe.skipIf(!hasDb)("lead board actions (database)", () => {
  it("a call marks a new lead contacted, keeps a later follow-up, and stamps the stage time", async () => {
    const gym = await makeGym();
    const desk = await gym.user("Receptionist", [gym.a.id]);
    const today = todayIso();
    const lead = await createLead(desk, { name: "Riya Call", phone: "9876533001", source: "Instagram", interest: "Monthly", followUpOn: addDays(today, 5), ownerId: desk.id });
    await db.lead.update({ where: { id: lead.id }, data: { stageAt: new Date(Date.now() - 5 * 86_400_000) } });

    await touchLead(desk, lead.id, "call");
    let l = await db.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(l.stage).toBe("Contacted");
    expect(l.followUpOn).toEqual(fromIso(addDays(today, 5)));
    expect(Date.now() - l.stageAt.getTime()).toBeLessThan(60_000);

    await touchLead(desk, lead.id, "whatsapp");
    l = await db.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(l.followUpOn).toEqual(fromIso(addDays(today, 2)));

    await setLeadStage(desk, lead.id, "Lost", { lostReason: "Joined elsewhere" });
    await touchLead(desk, lead.id, "call");
    expect((await db.lead.findUniqueOrThrow({ where: { id: lead.id } })).stage).toBe("Lost");
  });
});
