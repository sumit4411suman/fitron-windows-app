import { acknowledge } from "@/lib/services/biometric";
import { device, text } from "../device";

export async function POST(req: Request) {
  const { d } = await device(req);
  const body = await req.text();
  return text(d ? await acknowledge(d, body) : "OK");
}
