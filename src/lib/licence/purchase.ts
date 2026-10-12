import "server-only";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { collectBoughtLicence } from "@/lib/integrations/license";
import { cloudUrl } from "@/lib/integrations/sync";
import { log } from "@/lib/log";
import { importLicence, installation } from "./store";

// Buying or renewing this computer's licence on fitron.in (docs/local-windows/LICENSING.md). Settings › Licence opens
// fitron.in/windows/buy in the browser with this installation's id and a one-time claim; the owner pays there; this
// computer then collects the signed licence with the claim and installs it, while the page is open (every few seconds)
// and every hour after (src/lib/runtime/local-scheduler.ts), until it arrives or 30 days pass. The claim is kept in the
// data folder beside the licence:
//   licence-purchase.json   { claim, createdAt, openedAt? }
// Only the installation id and the claim leave the computer (src/lib/integrations/license).

const KEEP_DAYS = 30;
const file = (root: string) => path.join(root, "licence-purchase.json");

export type Purchase = { claim: string; createdAt: string; openedAt?: string };

export function readPurchase(root: string): Purchase | null {
  try {
    const p = JSON.parse(readFileSync(file(root), "utf8")) as Partial<Purchase>;
    return typeof p.claim === "string" && typeof p.createdAt === "string" ? (p as Purchase) : null;
  } catch {
    return null;
  }
}

function writePurchase(root: string, p: Purchase) {
  const tmp = `${file(root)}.tmp`;
  writeFileSync(tmp, JSON.stringify(p), { mode: 0o600 });
  renameSync(tmp, file(root));
}

const old = (iso: string, now: Date) => now.getTime() - Date.parse(iso) > KEEP_DAYS * 86_400_000;

/** The address of fitron.in's buy page for this computer, with its claim (made now if there is none, or it is too old). */
export function buyLink(root: string, today: string, now = new Date()): string | null {
  const id = installation(root, today).installationId;
  if (!id) return null;
  let p = readPurchase(root);
  if (!p || old(p.createdAt, now)) {
    p = { claim: randomBytes(32).toString("base64url"), createdAt: now.toISOString() };
    writePurchase(root, p);
  }
  return `${cloudUrl()}/windows/buy?${new URLSearchParams({ i: id, c: p.claim })}`;
}

/** The owner opened the buy page: from now on FITRON looks for the licence until it arrives. */
export function markOpened(root: string, now = new Date()) {
  const p = readPurchase(root);
  if (p) writePurchase(root, { ...p, openedAt: now.toISOString() });
}

/** A purchase this computer is waiting for: the buy page was opened in the last 30 days. */
export function waitingPurchase(root: string, now = new Date()): Purchase | null {
  const p = readPurchase(root);
  return p?.openedAt && !old(p.openedAt, now) ? p : null;
}

export type Collected =
  | { state: "installed"; licenceId: string; message: string }
  | { state: "waiting" | "preparing" | "offline" | "none" | "problem"; message: string };

/** Asks fitron.in for the licence bought with this computer's claim and, once paid, installs it. Never throws. */
export async function collectPurchase(root: string, today: string, now = new Date()): Promise<Collected> {
  const p = readPurchase(root);
  if (!p) return { state: "none", message: "No purchase started on this computer." };
  const id = installation(root, today).installationId;
  if (!id) return { state: "problem", message: "This computer has no installation id yet. Restart FITRON and try again." };
  let answer;
  try {
    answer = await collectBoughtLicence(id, p.claim);
  } catch (e) {
    log.error("licence.collect_failed", e);
    return { state: "problem", message: "FITRON could not ask fitron.in for the licence. It tries again by itself." };
  }
  if (!answer.ok) return { state: answer.reason === "offline" ? "offline" : "problem", message: answer.message };
  const a = answer.data;
  if (a.status === "paid") {
    const r = importLicence(root, a.licence, today);
    if (!r.ok) {
      log.error("licence.collected_refused", new Error(r.reason));
      return { state: "problem", message: `The licence from fitron.in could not be installed: ${r.reason} Write to hello@fitron.in with this computer's installation id.` };
    }
    // Done: the next purchase (a renewal) makes a new claim.
    if (existsSync(file(root))) rmSync(file(root), { force: true });
    log.info("licence.collected", { licenceId: r.licence.licenceId, plan: r.licence.plan, expiresOn: r.licence.expiresOn });
    return { state: "installed", licenceId: r.licence.licenceId, message: `Licence ${r.licence.licenceId} installed: ${r.licence.plan}, until ${r.licence.expiresOn}. Thank you.` };
  }
  if (a.status === "preparing") return { state: "preparing", message: "fitron.in has received the payment and is preparing the licence. FITRON installs it as soon as it is ready." };
  if (a.status === "pending") return { state: "waiting", message: "Waiting for the payment on fitron.in." };
  if (old(p.createdAt, now)) rmSync(file(root), { force: true });
  return { state: "none", message: "No payment yet. Pay on the fitron.in page that opened in the browser." };
}
