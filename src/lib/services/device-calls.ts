import "server-only";
import { deviceOptions } from "@/lib/domain/adms";
import { log } from "@/lib/log";
import { acknowledge, deviceFor, handleCdataPost, pendingCommands } from "./biometric";

// What a ZKTeco / eSSL device in ADMS ("cloud server") mode gets for each of its calls. One answer for both ways in: the
// Cloud Edition's /iclock routes (src/app/iclock) and FITRON for Windows' device port on the gym's network
// (src/lib/integrations/door-devices). Devices can't sign requests, so a new serial is only recorded; nothing it sends
// is used until a gym adds that serial in Settings › Biometric & doors.

export type DeviceCall = {
  /** The last part of the address: cdata, getrequest or devicecmd. */
  endpoint: string;
  method: string;
  params: URLSearchParams;
  /** The device's address on the network, shown beside it in Settings. */
  ip: string | null;
  body: string;
};

export type DeviceAnswer = { status: number; body: string };

export async function answerDevice(c: DeviceCall): Promise<DeviceAnswer> {
  const sn = c.params.get("SN") ?? "";
  const call = `${c.method} ${c.endpoint}`;
  if (call !== "GET cdata" && call !== "POST cdata" && call !== "GET getrequest" && call !== "POST devicecmd") return { status: 404, body: "Not found" };
  const d = await deviceFor(sn, c.ip);
  if (call === "GET cdata") {
    if (!sn) return { status: 400, body: "Missing SN" };
    // An unapproved device still gets its options so it keeps calling in and shows up for approval.
    return { status: 200, body: deviceOptions(d ? d.serial : sn) };
  }
  if (!d) return { status: 200, body: "OK" };
  if (call === "GET getrequest") return { status: 200, body: await pendingCommands(d) };
  if (call === "POST devicecmd") return { status: 200, body: await acknowledge(d, c.body) };
  try {
    return { status: 200, body: await handleCdataPost(d, c.params.get("table") ?? "", c.body) };
  } catch (e) {
    log.error("device_upload.failed", e);
    // Not OK: the device keeps the data and sends it again.
    return { status: 500, body: "ERROR" };
  }
}
