import "server-only";
import { db } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/current";
import { writeBranch } from "@/lib/auth/current";
import type { Prisma } from "@/generated/prisma/client";
import { checkRows, IMPORTS, MAX_ROWS, type CheckedRow, type Ctx, type ImportKind } from "@/lib/domain/import";
import { balanceDue } from "@/lib/domain/billing";
import { ymOf } from "@/lib/domain/assets";
import { audit } from "./audit";
import { UserError } from "./errors";
import { nextNumber } from "./sequence";
import { getSetting, putSetting } from "./settings";
import { fromIso, todayIso } from "./time";
import { prefixes, writeInvoice, writePayment } from "./billing";
import { writeAsset } from "./assets";
import { getTax } from "./tax";
import { getReminderSettings } from "./whatsapp";
import { activeMemberCount, assertBranchWritable, gymPlan } from "./saas";

type Tx = Prisma.TransactionClient;

export type Migration = {
  source?: string;
  done?: Partial<Record<ImportKind | "opening", { n: number; at: string }>>;
  /** The import in progress, sent in parts: what the parts so far brought in, so the last part can say it for the whole file. */
  run?: { key: string; made: number };
};
export type Opening = { cash?: number; bank?: number; asOf?: string };

export const getMigration = async (orgId: string) => (await getSetting<Migration>(orgId, "migration")) ?? {};
export const getOpening = async (orgId: string) => (await getSetting<Opening>(orgId, "opening")) ?? {};

/** What each member still owes on their issued invoices, in the branches this user works in. */
async function openDues(u: CurrentUser) {
  const invs = await db.invoice.findMany({
    where: { orgId: u.orgId, branchId: { in: u.branchIds }, status: "ISSUED" },
    select: { memberId: true, total: true, payments: { where: { status: "SUCCESS" }, select: { amount: true } } },
  });
  const out = new Map<string, number>();
  for (const i of invs) {
    const due = balanceDue(i.total, i.payments.reduce((s, p) => s + p.amount, 0));
    if (due > 0) out.set(i.memberId, (out.get(i.memberId) ?? 0) + due);
  }
  return out;
}

async function context(u: CurrentUser, branchId: string, kind: ImportKind): Promise<Ctx> {
  const [members, plans, products, cats, locks, reminders, dues] = await Promise.all([
    db.member.findMany({ where: { orgId: u.orgId, deletedAt: null, walkIn: false }, select: { id: true, phone: true, oldId: true, name: true, branchId: true } }),
    db.membershipPlan.findMany({ where: { orgId: u.orgId }, select: { id: true, name: true, months: true, price: true } }),
    db.product.findMany({ where: { branchId }, select: { name: true, sku: true } }),
    db.expenseCategory.findMany({ select: { id: true, name: true } }),
    u.can("months.unlock") ? [] : db.monthLock.findMany({ where: { branchId }, select: { month: true } }),
    getReminderSettings(u.orgId),
    kind === "payments" ? openDues(u) : undefined,
  ]);
  // Payments can only be matched to members this user can see.
  const visible = members.filter((m) => u.branchIds.includes(m.branchId));
  const byName = new Map<string, string[]>();
  for (const m of visible) byName.set(m.name.toLowerCase(), [...(byName.get(m.name.toLowerCase()) ?? []), m.id]);
  return {
    today: todayIso(),
    phones: new Set(members.map((m) => m.phone)),
    memberByPhone: new Map(visible.map((m) => [m.phone, m.id])),
    memberByOldId: new Map(visible.filter((m) => m.oldId).map((m) => [m.oldId!, m.id])),
    memberByName: byName,
    plans,
    productNames: new Set(products.map((p) => p.name.toLowerCase())),
    productSkus: new Set(products.map((p) => p.sku.toUpperCase())),
    expenseCats: cats,
    lockedMonths: new Set(locks.map((l) => l.month)),
    oldIds: new Set(members.filter((m) => m.oldId).map((m) => m.oldId!)),
    defaultMonths: reminders.defaultMonths,
    openDues: dues,
  };
}

function toRecords(kind: ImportKind, rows: string[][], map: Record<string, number>) {
  if (rows.length > MAX_ROWS) throw new UserError(`That's ${rows.length} rows. Split the file into parts of ${MAX_ROWS} or fewer.`);
  const fields = IMPORTS[kind].fields;
  for (const [key, label, required] of fields) if (required && !(map[key]! >= 0)) throw new UserError(`Pick the column for ${label}.`);
  return rows.map((r) => Object.fromEntries(fields.map(([key]) => [key, map[key]! >= 0 ? (r[map[key]!] ?? "") : ""])));
}

/** Check the rows against the database without writing anything. */
export async function previewImport(u: CurrentUser, kind: ImportKind, rows: string[][], map: Record<string, number>) {
  const branchId = writeBranch(u);
  if (!branchId) throw new UserError("Pick a branch first. Imported records go to one branch.");
  return checkRows(kind, toRecords(kind, rows, map), await context(u, branchId, kind));
}

/**
 * Rows per transaction. Every audit row takes the organisation's advisory lock for the rest of its transaction, so a
 * big chunk holds up every other save in the gym (member saves timed out behind a 100-row chunk). Small chunks hand
 * the lock back often.
 */
const CHUNK = 10;

/** A later call of a commit split into parts by the import page: `index` of `of`, 1-based; `fileRows`, the rows in the whole file. */
export type ImportPart = { index: number; of: number; fileRows?: number };

export type ImportOptions = {
  /** "These members gave consent on paper when they joined": every imported member whose row has no consent value gets today's date. */
  consentOnPaper?: boolean;
};

export type ImportResult = { made: number; skipped: number; plansCreated: number; /** Names of plans created inactive at the row's price; an admin sets the price and activates them. */ plansInactive: string[] };

/**
 * Re-checks every row, then imports the valid ones in small transactions. Returns how many were imported.
 * The import page sends a big file in parts (`part`), each its own call, so the browser can show progress and no
 * single request runs long; a part whose rows were all imported by an earlier part comes back with `made: 0`
 * rather than an error, so a resumed or repeated part is harmless.
 */
export async function commitImport(u: CurrentUser, kind: ImportKind, rows: string[][], map: Record<string, number>, fileName: string, part?: ImportPart, options: ImportOptions = {}): Promise<ImportResult> {
  const branchId = writeBranch(u);
  if (!branchId) throw new UserError("Pick a branch first. Imported records go to one branch.");
  const checked = checkRows(kind, toRecords(kind, rows, map), await context(u, branchId, kind)).filter((r) => r.errors.length === 0);
  if (!checked.length) {
    if (part) return { made: 0, skipped: rows.length, plansCreated: 0, plansInactive: [] };
    throw new UserError("No valid rows to import.");
  }
  await assertBranchWritable(db, u.orgId, branchId);
  if (kind === "members") {
    const plan = await gymPlan(u.orgId);
    const room = plan.terms.memberLimit === null ? Infinity : plan.terms.memberLimit - (await activeMemberCount(db, u.orgId));
    if (checked.length > room) {
      throw new UserError(`Your ${plan.name} plan allows ${plan.terms.memberLimit} active members, so ${Math.max(room, 0)} more fit. Move to a bigger plan in Settings › Plan & billing, or import fewer rows.`);
    }
  }
  const mig = await getMigration(u.orgId);
  const source = mig.source?.trim() || "previous software";
  const tax = await getTax(u.orgId);
  const pre = await prefixes(u.orgId);
  const memberPrefix = (await getSetting<{ memberPrefix?: string }>(u.orgId, "numbering"))?.memberPrefix ?? "FT-";
  const plansMade = new Map<string, { id: string; name: string }>();
  let made = 0;

  for (let i = 0; i < checked.length; i += CHUNK) {
    const slice = checked.slice(i, i + CHUNK);
    await db.$transaction(
      async (tx) => {
        for (const r of slice) {
          await writeRow(tx, u, kind, branchId, r, { source, tax, pre, memberPrefix, plansMade, consentAt: options.consentOnPaper ? new Date() : null });
          made++;
        }
      },
      { timeout: 60_000, maxWait: 20_000 },
    );
  }

  const plansInactive = [...plansMade.values()].map((p) => p.name);
  // The step counter adds up across parts; a re-read of the setting per call keeps two parts from clobbering each other.
  // So does this file's running total, which the first part starts and the last part reports for the whole file.
  const latest = await getMigration(u.orgId);
  const key = `${kind}:${fileName}:${part?.of ?? 1}`;
  const total = (part && part.index > 1 && latest.run?.key === key ? latest.run.made : 0) + made;
  const last = !part || part.index >= part.of;
  await db.$transaction(async (tx) => {
    await audit(tx, {
      orgId: u.orgId,
      userId: u.id,
      action: `import.${kind}`,
      entity: "Import",
      entityId: kind,
      after: {
        file: fileName,
        ...(part ? { part: `${part.index}/${part.of}` } : {}),
        rows: part?.fileRows ?? rows.length,
        imported: made,
        ...(last ? { total } : {}),
        plansCreated: plansMade.size,
        plansInactive,
      },
    });
  });
  await putSetting(u, "migration", {
    done: { ...(latest.done ?? {}), [kind]: { n: (latest.done?.[kind]?.n ?? 0) + made, at: new Date().toISOString() } },
    run: { key, made: total },
  });
  return { made, skipped: rows.length - made, plansCreated: plansMade.size, plansInactive };
}

async function writeRow(
  tx: Tx,
  u: CurrentUser,
  kind: ImportKind,
  branchId: string,
  r: CheckedRow,
  o: { source: string; tax: Awaited<ReturnType<typeof getTax>>; pre: { invoice: string; payment: string }; memberPrefix: string; plansMade: Map<string, { id: string; name: string }>; consentAt?: Date | null },
) {
  const d = r.data as Record<string, never>;
  if (kind === "members") {
    let planId: string | null = d.planId;
    if (!planId) {
      const key = String(d.planName).toLowerCase();
      planId = o.plansMade.get(key)?.id ?? null;
      if (!planId) {
        // A plan the file names but the gym hasn't set up: created inactive at the row's amount (often ₹0), so it
        // can't be sold until an admin sets the price and activates it in Plans (bug 10).
        const p = await tx.membershipPlan.create({
          data: { orgId: u.orgId, name: d.planName, months: d.months, price: d.amount, regFee: 0, gstApplicable: false, kind: "Membership", status: "INACTIVE", description: "Created during migration · set the price and activate before selling", features: [] },
        });
        await audit(tx, { orgId: u.orgId, userId: u.id, action: "plan.create", entity: "MembershipPlan", entityId: p.id, after: p });
        o.plansMade.set(key, { id: p.id, name: p.name });
        planId = p.id;
      }
    }
    const n = await nextNumber(tx, u.orgId, "member");
    const m = await tx.member.create({
      data: {
        orgId: u.orgId,
        branchId,
        code: `${o.memberPrefix}${n}`,
        oldId: d.oldId,
        name: d.name,
        gender: d.gender,
        dob: d.dob ? fromIso(d.dob) : null,
        phone: d.phone,
        whatsapp: d.phone,
        email: d.email,
        house: d.house,
        city: d.city,
        pin: d.pin,
        source: "Other",
        notes: [d.notes, `Migrated from ${o.source}${d.oldId ? ` (ID ${d.oldId})` : ""}`].filter(Boolean).join(" · "),
        tags: [],
        // The row's own consent date wins; else the import-time "gave consent on paper" tick; else none is recorded.
        consentAt: d.consentAt ? fromIso(d.consentAt) : (o.consentAt ?? null),
        createdById: u.id,
        // When they joined the gym, not when they were typed into Fitron (see checkRows).
        createdAt: fromIso(d.joined),
      },
    });
    await audit(tx, { orgId: u.orgId, userId: u.id, action: "member.import", entity: "Member", entityId: m.id, after: m });
    const amount: number = d.amount;
    const inv = await writeInvoice(tx, u, {
      branchId,
      memberId: m.id,
      date: d.invDate,
      dueDate: d.start,
      lines: [{ description: `${d.planName} membership (migrated)`, category: "New Membership", qty: 1, rate: amount, discount: 0, taxRate: 0, planId }],
      prefix: o.pre.invoice,
      tax: { ...o.tax, enabled: false },
    });
    const msNo = await nextNumber(tx, u.orgId, "membership", 1);
    await tx.membership.create({ data: { code: `MS-${msNo}`, memberId: m.id, planId, branchId, type: "IMPORT", startDate: fromIso(d.start), endDate: fromIso(d.end), price: amount, discount: 0, pricingCategory: "Standard", invoiceId: inv.id } });
    if ((d.paid as number) > 0) await writePayment(tx, u, { branchId, memberId: m.id, invoiceId: inv.id, date: d.invDate, amount: d.paid, method: "Other", notes: `Opening balance from ${o.source}`, prefix: o.pre.payment });
    return;
  }
  if (kind === "payments") {
    const member = await tx.member.findUniqueOrThrow({ where: { id: d.memberId } });
    const pay = { memberId: member.id, date: d.date as string, method: d.method as string, txnRef: (d.txn as string | null) ?? undefined, notes: `Migrated receipt from ${o.source}`, prefix: o.pre.payment };
    // A receipt first settles what the member owes, oldest invoice first (often the invoice the member import made for
    // their current plan). Only what is left over is a sale of its own, or revenue and dues would both count it twice.
    let left: number = d.amount;
    const open = await tx.invoice.findMany({
      where: { orgId: u.orgId, memberId: member.id, branchId: { in: u.branchIds }, status: "ISSUED" },
      orderBy: [{ date: "asc" }, { createdAt: "asc" }],
      select: { id: true, branchId: true, total: true, payments: { where: { status: "SUCCESS" }, select: { amount: true } } },
    });
    for (const inv of open) {
      if (left <= 0) break;
      const due = balanceDue(inv.total, inv.payments.reduce((s, p) => s + p.amount, 0));
      if (due <= 0) continue;
      const amount = Math.min(due, left);
      await writePayment(tx, u, { ...pay, branchId: inv.branchId, invoiceId: inv.id, amount });
      left -= amount;
    }
    if (left <= 0) return;
    const inv = await writeInvoice(tx, u, {
      branchId: member.branchId,
      memberId: member.id,
      date: d.date,
      dueDate: d.date,
      lines: [{ description: `${d.desc} (migrated receipt${d.txn ? ` ${d.txn}` : ""})`, category: "Other", qty: 1, rate: left, discount: 0, taxRate: 0 }],
      prefix: o.pre.invoice,
      tax: { ...o.tax, enabled: false },
    });
    await writePayment(tx, u, { ...pay, branchId: member.branchId, invoiceId: inv.id, amount: left });
    return;
  }
  if (kind === "expenses") {
    const n = await nextNumber(tx, u.orgId, "expense", 1);
    const e = await tx.expense.create({ data: { code: `EXP-${n}`, orgId: u.orgId, branchId, date: fromIso(d.date), categoryId: d.categoryId, description: d.description, vendor: d.vendor, amount: d.amount, method: d.method, billNo: d.billNo, notes: `Migrated from ${o.source}`, createdById: u.id } });
    await audit(tx, { orgId: u.orgId, userId: u.id, action: "expense.import", entity: "Expense", entityId: e.id, after: e });
    return;
  }
  if (kind === "products") {
    const p = await tx.product.create({ data: { orgId: u.orgId, branchId, sku: d.sku, name: d.name, category: d.category, price: d.price, cost: d.cost, stock: d.stock, reorderLevel: d.reorder } });
    if ((d.stock as number) > 0) await tx.stockMovement.create({ data: { productId: p.id, qty: d.stock, reason: "RESTOCK", unitCost: d.cost, note: `Opening stock from ${o.source}`, createdById: u.id } });
    await audit(tx, { orgId: u.orgId, userId: u.id, action: "product.import", entity: "Product", entityId: p.id, after: p });
    return;
  }
  // assets
  const accDep: number = d.accDep;
  await writeAsset(
    tx,
    u,
    branchId,
    {
      name: d.name,
      category: d.category,
      qty: d.qty,
      vendor: d.vendor,
      purchaseDate: fromIso(d.purchaseDate),
      cost: d.cost,
      salvage: 0,
      method: d.method,
      rate: d.method === "WDV" ? d.rate : null,
      life: d.method === "SLM" ? d.life : null,
      serial: d.serial,
      billNo: null,
      notes: `Migrated from ${o.source}${accDep ? ` · book value carried at ₹${((d.cost - accDep) / 100).toLocaleString("en-IN")}` : ""}`,
      accDepCarried: accDep,
      depFrom: accDep ? ymOf(todayIso()) : null,
    },
    null,
  );
}

export async function setMigrationSource(u: CurrentUser, source: string) {
  await putSetting(u, "migration", { source: source.trim().slice(0, 80) });
}

/** Cash in hand and bank balance on the day the gym switched to Fitron; the cash and bank books start from them. */
export async function setOpening(u: CurrentUser, v: { cash: number; bank: number; asOf: string }) {
  if (v.asOf > todayIso()) throw new UserError("The date can't be in the future.", "asOf");
  await putSetting(u, "opening", v);
  const mig = await getMigration(u.orgId);
  await putSetting(u, "migration", { done: { ...(mig.done ?? {}), opening: { n: 1, at: new Date().toISOString() } } });
}
