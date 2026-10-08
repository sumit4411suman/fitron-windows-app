import { pendingCommands } from "@/lib/services/biometric";
import { device, text } from "../device";

export async function GET(req: Request) {
  const { d } = await device(req);
  return text(d ? await pendingCommands(d) : "OK");
}
