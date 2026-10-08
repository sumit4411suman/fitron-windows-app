import { deviceOptions } from "@/lib/domain/adms";
import { handleCdataPost } from "@/lib/services/biometric";
import { device, text } from "../device";
import { log } from "@/lib/log";

export async function GET(req: Request) {
  const { sn, d } = await device(req);
  if (!sn) return text("Missing SN", 400);
  // An unapproved device still gets its options so it keeps calling in and shows up for approval.
  return text(d ? deviceOptions(d.serial) : deviceOptions(sn));
}

export async function POST(req: Request) {
  const { d } = await device(req);
  const body = await req.text();
  if (!d) return text("OK");
  const table = new URL(req.url).searchParams.get("table") ?? "";
  try {
    return text(await handleCdataPost(d, table, body));
  } catch (e) {
    log.error("device_upload.failed", e);
    // Not OK: the device keeps the data and sends it again.
    return text("ERROR", 500);
  }
}
