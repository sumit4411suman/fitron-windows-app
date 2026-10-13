import "server-only";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import { db } from "@/lib/db";
import { log } from "@/lib/log";
import { readLocalSettings } from "@/lib/runtime/local-settings";
import { syncDevices } from "@/lib/services/biometric";
import { answerDevice } from "@/lib/services/device-calls";

// FITRON for Windows: the door devices' way in. FITRON's own server answers only this computer (127.0.0.1), and a
// ZKTeco / eSSL device in ADMS mode has to reach FITRON over the gym's network. So, once a Super Admin turns it on
// (Settings › Biometric & doors), FITRON also listens on one port of this computer's network addresses (8081 unless
// changed) and answers there only what a device calls: /iclock/cdata, /iclock/getrequest and /iclock/devicecmd, from an
// address on the local network, with the same answers as the Cloud Edition's /iclock routes (src/lib/services/
// device-calls.ts). No page, sign-in or other address of FITRON is reachable on that port. Nothing leaves the computer.
//
// While it listens, every device is kept in step with who may come in, every two minutes rather than once a day as on
// fitron.in: a member whose plan ends (or who is suspended, or owes more than the limit) is taken off the devices, so the
// door no longer opens for them, and one who renews is put back as quickly.

export const DEVICE_SYNC_EVERY_MS = 2 * 60_000;
/** A device's upload after days without FITRON (punches, face templates) stays far below this. */
const MAX_BODY = 16 * 1024 * 1024;

type Gateway = { server: Server | null; port: number | null; error: string | null; timer: NodeJS.Timeout | null; syncing: boolean; queue: Promise<unknown> };

const g = globalThis as unknown as { fitronDoorDevices?: Gateway; fitronStopping?: boolean };
const state = () => (g.fitronDoorDevices ??= { server: null, port: null, error: null, timer: null, syncing: false, queue: Promise.resolve() });

// ── Addresses ─────────────────────────────────────────────────────────────

/** "::ffff:192.168.1.5" → "192.168.1.5". */
export const plainAddress = (a: string | undefined | null) => (a ?? "").replace(/^::ffff:/i, "");

/** True for an address a device in the gym can have: 10/8, 172.16/12, 192.168/16, link-local 169.254/16, or this computer. */
export function onLocalNetwork(ip: string): boolean {
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if ([a, b, Number(m[3]), Number(m[4])].some((n) => n > 255)) return false;
  return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
}

export type ComputerAddress = { name: string; address: string };

/** Adapters a device never sits behind: virtual machines, VPNs and Bluetooth. Listed last. */
const VIRTUAL = /vethernet|virtual|vmware|vbox|hyper-v|wsl|docker|tailscale|zerotier|vpn|bluetooth/i;

/** This computer's addresses on local networks, the one to type on the device first. */
export function thisComputersAddresses(interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = os.networkInterfaces()): ComputerAddress[] {
  const out: ComputerAddress[] = [];
  for (const [name, list] of Object.entries(interfaces)) {
    for (const a of list ?? []) {
      if (a.internal || a.family !== "IPv4" || !onLocalNetwork(a.address) || a.address.startsWith("169.254.")) continue;
      out.push({ name, address: a.address });
    }
  }
  return out.sort((x, y) => Number(VIRTUAL.test(x.name)) - Number(VIRTUAL.test(y.name)));
}

// ── Answering devices ─────────────────────────────────────────────────────

function send(res: ServerResponse, status: number, body: string) {
  const b = Buffer.from(body, "utf8");
  // A length rather than chunks: older device firmware reads only that.
  res.writeHead(status, { "Content-Type": "text/plain", "Content-Length": b.length });
  res.end(b);
}

/** The request body, or null when it is larger than `limit` (the rest is read and dropped). */
function readBody(req: IncomingMessage, limit: number): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const parts: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size <= limit) parts.push(c);
    });
    req.on("end", () => resolve(size > limit ? null : Buffer.concat(parts)));
    req.on("error", reject);
  });
}

export async function answerDeviceRequest(req: IncomingMessage, res: ServerResponse) {
  try {
    const ip = plainAddress(req.socket.remoteAddress);
    if (!onLocalNetwork(ip)) return send(res, 403, "FITRON answers only devices on this computer's network.");
    const url = new URL(req.url ?? "/", "http://device.invalid");
    // Some firmware adds .aspx, as for ZKTeco's own Windows server.
    const m = url.pathname.match(/^\/iclock\/([a-z]+)(?:\.aspx)?$/i);
    const method = req.method ?? "GET";
    if (!m || (method !== "GET" && method !== "POST")) return send(res, 404, "Not found");
    const body = method === "POST" ? await readBody(req, MAX_BODY) : Buffer.alloc(0);
    if (!body) return send(res, 413, "Too large");
    const a = await answerDevice({ endpoint: m[1]!.toLowerCase(), method, params: url.searchParams, ip, body: body.toString("utf8") });
    send(res, a.status, a.body);
  } catch (e) {
    log.error("door_devices.request_failed", e);
    if (!res.headersSent) send(res, 500, "ERROR");
    else res.destroy();
  }
}

// ── Keeping devices in step ───────────────────────────────────────────────

/** Loads allowed members onto every gym's devices and takes the others off. One pass at a time. */
export async function syncAllDevices() {
  const st = state();
  if (st.syncing || g.fitronStopping) return { changes: 0 };
  st.syncing = true;
  try {
    const orgs = new Set((await db.device.findMany({ where: { approved: true, orgId: { not: null } }, select: { orgId: true } })).map((d) => d.orgId!));
    let changes = 0;
    for (const orgId of orgs) changes += (await syncDevices(orgId)).changes;
    if (changes) log.info("door_devices.sync", { changes });
    return { changes };
  } catch (e) {
    log.error("door_devices.sync_failed", e);
    return { changes: 0 };
  } finally {
    st.syncing = false;
  }
}

// ── Listening ─────────────────────────────────────────────────────────────

function portProblem(e: unknown, port: number) {
  const code = (e as { code?: string }).code;
  if (code === "EADDRINUSE") return `Another program on this computer already uses port ${port}. Pick another port here, and set the same port on the device.`;
  if (code === "EACCES") return `Windows did not let FITRON use port ${port}. Pick another port, such as 8081.`;
  return `FITRON could not listen on port ${port} (${code ?? (e instanceof Error ? e.message : String(e))}).`;
}

function listen(port: number, host: string): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => void answerDeviceRequest(req, res));
    server.requestTimeout = 120_000;
    server.headersTimeout = 30_000;
    server.on("clientError", (_e, socket) => socket.destroy());
    server.once("error", reject);
    server.listen({ port, host, exclusive: true }, () => {
      server.off("error", reject);
      server.on("error", (e) => log.error("door_devices.server_error", e));
      resolve(server);
    });
  });
}

async function close(st: Gateway) {
  if (st.timer) clearInterval(st.timer);
  st.timer = null;
  const s = st.server;
  st.server = null;
  st.port = null;
  if (!s) return;
  await new Promise<void>((r) => {
    s.close(() => r());
    s.closeAllConnections();
  });
}

export type DeviceNetwork = { listening: boolean; port: number | null; error: string | null };

const now = (st: Gateway): DeviceNetwork => ({ listening: !!st.server, port: st.port, error: st.error });

/**
 * Starts, moves or stops the device port. `host` is for tests (127.0.0.1); FITRON listens on every network address of
 * the computer. One change at a time.
 */
export function applyDeviceNetwork(o: { on: boolean; port: number; host?: string }): Promise<DeviceNetwork> {
  const st = state();
  const run = async (): Promise<DeviceNetwork> => {
    if (st.server && (!o.on || st.port !== o.port)) await close(st);
    st.error = null;
    if (!o.on || st.server || g.fitronStopping) return now(st);
    if (!Number.isInteger(o.port) || o.port < 1 || o.port > 65535) {
      st.error = "Type a port from 1 to 65535, such as 8081.";
      return now(st);
    }
    if (process.env.PORT && o.port === Number(process.env.PORT)) {
      st.error = `Port ${o.port} is FITRON's own. Pick another port, such as 8081.`;
      return now(st);
    }
    try {
      st.server = await listen(o.port, o.host ?? "0.0.0.0");
      st.port = (st.server.address() as AddressInfo).port;
      // Right away (a device that was waiting gets its members), then every two minutes.
      setTimeout(() => void syncAllDevices(), 5_000).unref();
      st.timer = setInterval(() => void syncAllDevices(), DEVICE_SYNC_EVERY_MS);
      st.timer.unref();
      log.info("door_devices.listening", { port: st.port });
    } catch (e) {
      st.error = portProblem(e, o.port);
      log.warn("door_devices.listen_failed", e, { port: o.port });
    }
    return now(st);
  };
  const next = st.queue.then(run, run);
  st.queue = next.catch(() => {});
  return next;
}

/** At start-up (src/lib/runtime/local-start.ts): listen if the Super Admin turned devices on. */
export function startDeviceNetworkFromSettings() {
  const s = readLocalSettings();
  return applyDeviceNetwork({ on: s.deviceNetwork === true, port: s.devicePort });
}

/** When FITRON closes (src/lib/runtime/local-shutdown.ts): no device call is answered while the database is put away. */
export function stopDeviceNetwork() {
  return applyDeviceNetwork({ on: false, port: 0 });
}

export type DeviceNetworkStatus = DeviceNetwork & { on: boolean; addresses: ComputerAddress[]; syncing: boolean };

/** For Settings › Biometric & doors: what is set, whether FITRON listens, and this computer's addresses. */
export function deviceNetworkStatus(): DeviceNetworkStatus {
  const s = readLocalSettings();
  const st = state();
  return { on: s.deviceNetwork === true, ...now(st), port: st.port ?? s.devicePort, addresses: thisComputersAddresses(), syncing: st.syncing };
}
