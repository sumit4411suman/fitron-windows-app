import { answerRequest } from "../device";
import { notInLocal } from "@/lib/runtime/not-in-local";

// On FITRON for Windows devices reach the same answers through the device port instead (src/lib/integrations/door-devices).

export async function GET(req: Request) {
  const off = notInLocal();
  if (off) return off;
  return answerRequest(req, "cdata");
}

export async function POST(req: Request) {
  const off = notInLocal();
  if (off) return off;
  return answerRequest(req, "cdata");
}
