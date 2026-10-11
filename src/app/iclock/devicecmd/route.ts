import { acknowledge } from "@/lib/services/biometric";
import { device, text } from "../device";
import { notInLocal } from "@/lib/runtime/not-in-local";

export async function POST(req: Request) {
  const off = notInLocal();
  if (off) return off;
  const { d } = await device(req);
  const body = await req.text();
  return text(d ? await acknowledge(d, body) : "OK");
}
