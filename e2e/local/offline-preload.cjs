// Loaded into a FITRON server with NODE_OPTIONS="--require …/offline-preload.cjs" by the offline tests: this machine
// has no internet. Name lookups fail (ENOTFOUND, as with Wi-Fi off) and connections to anything but this computer are
// refused (ENETUNREACH). Every attempt is written, one JSON line each, to FITRON_OFFLINE_LOG, so a test can prove which
// features tried to go online. Loopback (127.0.0.1, ::1, localhost) keeps working.
"use strict";
/* eslint-disable @typescript-eslint/no-require-imports -- a --require preload is CommonJS, loaded before any module system */
const dns = require("node:dns");
const net = require("node:net");
const fs = require("node:fs");

const LOG = process.env.FITRON_OFFLINE_LOG;
const isLoopback = (h) => !h || h === "localhost" || h === "::1" || /^127\./.test(h) || h === "0.0.0.0";
const record = (kind, host) => {
  if (!LOG) return;
  const stack = (new Error().stack || "").split("\n").slice(3, 9).map((l) => l.trim()).join(" | ");
  try {
    fs.appendFileSync(LOG, JSON.stringify({ at: new Date().toISOString(), kind, host, stack }) + "\n");
  } catch {}
};
const fail = (host, code) => Object.assign(new Error(`${code === "ENOTFOUND" ? "getaddrinfo" : "connect"} ${code} ${host} (offline)`), { code, errno: code === "ENOTFOUND" ? -3008 : -101, syscall: code === "ENOTFOUND" ? "getaddrinfo" : "connect", hostname: host });

const realLookup = dns.lookup;
dns.lookup = function (host, options, cb) {
  if (typeof options === "function") {
    cb = options;
    options = {};
  }
  if (isLoopback(host)) return realLookup.call(dns, host, options, cb);
  record("dns", host);
  process.nextTick(() => cb(fail(host, "ENOTFOUND")));
  return {};
};
const realPLookup = dns.promises.lookup;
dns.promises.lookup = (host, options) => (isLoopback(host) ? realPLookup.call(dns.promises, host, options) : (record("dns", host), Promise.reject(fail(host, "ENOTFOUND"))));
for (const fn of ["resolve", "resolve4", "resolve6", "resolveMx", "resolveTxt", "resolveSrv"]) {
  const real = dns[fn];
  if (typeof real !== "function") continue;
  dns[fn] = function (host, ...rest) {
    const cb = rest[rest.length - 1];
    if (isLoopback(host)) return real.call(dns, host, ...rest);
    record("dns", host);
    process.nextTick(() => cb(fail(host, "ENOTFOUND")));
  };
}
const realConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const o = typeof args[0] === "object" && args[0] !== null ? (Array.isArray(args[0]) ? args[0][0] : args[0]) : { port: args[0], host: typeof args[1] === "string" ? args[1] : undefined };
  const host = o && (o.host || o.hostname);
  if (o && !o.path && host && net.isIP(host) && !isLoopback(host)) {
    record("connect", host);
    process.nextTick(() => this.destroy(fail(host, "ENETUNREACH")));
    return this;
  }
  return realConnect.apply(this, args);
};
