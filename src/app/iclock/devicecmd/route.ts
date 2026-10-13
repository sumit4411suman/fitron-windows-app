import { answerRequest } from "../device";
import { notInLocal } from "@/lib/runtime/not-in-local";

export async function POST(req: Request) {
  const off = notInLocal();
  if (off) return off;
  return answerRequest(req, "devicecmd");
}
