// ZKTeco / eSSL ADMS ("iclock" push) protocol: parsing what devices post, formatting what they poll for.

export type Punch = { pin: string; time: string; verify: number };

/** ATTLOG body: one punch per line, tab-separated: PIN, "YYYY-MM-DD HH:MM:SS", status, verify mode, … */
export function parseAttlog(body: string): Punch[] {
  const out: Punch[] = [];
  for (const line of body.split(/\r?\n/)) {
    const f = line.split("\t");
    if (f.length < 2) continue;
    const pin = f[0]!.trim();
    const time = f[1]!.trim();
    if (!/^\d{1,24}$/.test(pin) || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(time)) continue;
    out.push({ pin, time: time.length === 16 ? `${time}:00` : time, verify: Number(f[3] ?? 0) || 0 });
  }
  return out;
}

/** Verify mode → how the member identified themselves. */
export function verifyMethod(v: number) {
  if (v === 1) return "Fingerprint";
  if (v === 15 || v === 9) return "Face";
  if (v === 4 || v === 2) return "Card";
  if (v === 3 || v === 0) return "Password";
  return "Fingerprint";
}

/** "KEY=value\tKEY=value" → record (keys as written). */
export function kv(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of s.split("\t")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

export type TemplateRecord = { pin: string; type: "FP" | "FACE"; slot: number; line: string };

/**
 * OPERLOG / BIODATA bodies carry enrolled templates:
 *   FP PIN=12\tFID=6\tSize=1024\tValid=1\tTMP=…           (fingerprint)
 *   BIODATA Pin=12\tNo=0\tIndex=0\tValid=1\t…\tType=9\t…\tTmp=…   (face and others)
 * `line` is the record without its leading keyword, as the device will want it back.
 */
export function parseTemplates(body: string): TemplateRecord[] {
  const out: TemplateRecord[] = [];
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^FP\s+(.*)$/))) {
      const f = kv(m[1]!);
      if (f.PIN && (f.TMP || f.Tmp)) out.push({ pin: f.PIN, type: "FP", slot: Number(f.FID ?? 0), line: m[1]! });
    } else if ((m = line.match(/^BIODATA\s+(.*)$/))) {
      const f = kv(m[1]!);
      const pin = f.Pin ?? f.PIN;
      if (pin && (f.Tmp || f.TMP)) out.push({ pin, type: Number(f.Type) === 1 ? "FP" : "FACE", slot: Number(f.No ?? 0) * 10 + Number(f.Index ?? 0), line: m[1]! });
    }
  }
  return out;
}

/** devicecmd body: lines like "ID=12&Return=0&CMD=DATA". */
export function parseAcks(body: string) {
  return body
    .split(/\r?\n/)
    .map((l) => new URLSearchParams(l.trim()))
    .filter((p) => p.get("ID"))
    .map((p) => ({ cmdNo: Number(p.get("ID")), ret: p.get("Return") ?? "", cmd: p.get("CMD") ?? "" }))
    .filter((a) => Number.isInteger(a.cmdNo));
}

/** Device names can't carry tabs or newlines, and keep them short. */
const clean = (s: string) => s.replace(/[\t\r\n=]/g, " ").slice(0, 24);

export const cmd = {
  addUser: (pin: string, name: string, card = "") => `DATA UPDATE USERINFO PIN=${pin}\tName=${clean(name)}\tPri=0\tPasswd=\tCard=${card.replace(/\D/g, "")}\tGrp=1\tTZ=0000000100000000\tVerify=0`,
  deleteUser: (pin: string) => `DATA DELETE USERINFO PIN=${pin}`,
  restoreTemplate: (t: { type: string; line: string }) => (t.type === "FP" && /^PIN=/.test(t.line) ? `DATA UPDATE FINGERTMP ${t.line}` : `DATA UPDATE BIODATA ${t.line}`),
  enrollFinger: (pin: string, finger = 6) => `ENROLL_FP PIN=${pin}\tFID=${finger}\tRETRY=3\tOVERWRITE=1`,
  enrollFace: (pin: string) => `ENROLL_BIO TYPE=9\tPIN=${pin}\tRETRY=3\tOVERWRITE=1`,
  openDoor: (seconds: number) => `CONTROL DEVICE 0101${Math.max(1, Math.min(60, seconds)).toString(16).padStart(2, "0")}00`,
  setTime: (unixIst: number) => `SET OPTION DateTime=${unixIst}`,
};

/** The options block a device gets on its first GET /iclock/cdata. Times on the device are India time. */
export function deviceOptions(serial: string) {
  return [
    `GET OPTION FROM: ${serial}`,
    "ATTLOGStamp=None",
    "OPERLOGStamp=9999",
    "ATTPHOTOStamp=None",
    "ErrorDelay=30",
    "Delay=5",
    "TransTimes=00:00;12:00",
    "TransInterval=1",
    "TransFlag=TransData AttLog OpLog EnrollUser ChgUser EnrollFP ChgFP FACE",
    "TimeZone=330",
    "Realtime=1",
    "Encrypt=None",
    "",
  ].join("\n");
}
