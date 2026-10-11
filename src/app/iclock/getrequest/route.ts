import { pendingCommands } from "@/lib/services/biometric";
import { device, text } from "../device";
import { notInLocal } from "@/lib/runtime/not-in-local";

export async function GET(req: Request) {
  const off = notInLocal();
  if (off) return off;
  const { d } = await device(req);
  return text(d ? await pendingCommands(d) : "OK");
}
