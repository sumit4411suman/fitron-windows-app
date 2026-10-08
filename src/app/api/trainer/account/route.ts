import { deleteTrainerAccount, exportTrainer } from "@/lib/services/trainer";
import { endTrainerSession } from "@/lib/services/trainer-session";
import { json, withTrainer } from "../_lib/http";

/** Download a copy of everything kept for the member. */
export async function GET() {
  return withTrainer(async (m) =>
    Response.json(await exportTrainer(m.id), { headers: { "content-disposition": `attachment; filename="fitron-my-data-${new Date().toISOString().slice(0, 10)}.json"`, "cache-control": "no-store" } }),
  );
}

/** Delete the account's fitness data and sign out. */
export async function DELETE() {
  return withTrainer(async (m) => {
    await deleteTrainerAccount(m.id);
    await endTrainerSession();
    return json({ ok: true });
  });
}
