import "server-only";
import { db } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/current";
import { writeBranch } from "@/lib/auth/current";
import type { Prisma } from "@/generated/prisma/client";
import { checkRows, IMPORTS, MAX_ROWS, type CheckedRow, type Ctx, type ImportKind } from "@/lib/domain/import";
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

export type Migration = { source?: string; done?: Partial<Record<ImportKind | "opening", { n: number; at: string }>> };
export type Opening = { cash?: number; bank?: number; asOf?: string };

export const getMigration = async (orgId: string) => (await getSetting<Migration>(orgId, "migration")) ?? {};
export const getOpening = async (orgId: string) => (await getSetting<Opening>(orgId, "opening")) ?? {};

async function context(u: CurrentUser, branchId: string): Promise<Ctx> {
  const [members, plans, products, cats, locks, reminders] = await Promise.all([
    db.member.findMany({ where: { orgId: u.orgId, deletedAt: null, walkIn: false }, select: { id: true, phone: true, oldId: true, name: true, branchId: true } }),
    db.membershipPlan.findMany({ where: { orgId: u.orgId }, select: { id: true, name: true, months: true, price: true } }),
    db.product.findMany({ where: { branchId }, select: { name: true, sku: true } }),
    db.expenseCategory.findMany({ select: { id: true, name: true } }),
    u.can("months.unlock") ? [] : db.monthLock.findMany({ where: { branchId }, select: { month: true } }),
    getReminderSettings(u.orgId),
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
  return checkRows(kind, toRecords(kind, rows, map), await context(u, branchId));
}

const CHUNK = 100;

/** Re-checks every row, then imports the valid ones in batches. Returns how many were imported. */
export async function commitImport(u: CurrentUser, kind: ImportKind, rows: string[][], map: Record<string, number>, fileName: string) {
  const branchId = writeBranch(u);
  if (!branchId) throw new UserError("Pick a branch first. Imported records go to one branch.");
  const checked = checkRows(kind, toRecords(kind, rows, map), await context(u, branchId)).filter((r) => r.errors.length === 0);
  if (!checked.length) throw new UserError("No valid rows to import.");
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
  const plansMade = new Map<string, string>();
  let made = 0;

  for (let i = 0; i < checked.length; i += CHUNK) {
    const part = checked.slice(i, i + CHUNK);
    await db.$transaction(
      async (tx) => {
        for (const r of part) {
          await writeRow(tx, u, kind, branchId, r, { source, tax, pre, memberPrefix, plansMade });
          made++;
        }
      },
      { timeout: 120_000, maxWait: 20_000 },
    );
  }

  await db.$transaction(async (tx) => {
    await audit(tx, { orgId: u.orgId, userId: u.id, action: `import.${kind}`, entity: "Import", entityId: kind, after: { file: fileName, rows: rows.length, imported: made, plansCreated: plansMade.size } });
  });
  await putSetting(u, "migration", { done: { ...(mig.done ?? {}), [kind]: { n: (mig.done?.[kind]?.n ?? 0) + made, at: new Date().toISOString() } } });
  return { made, skipped: rows.length - made, plansCreated: plansMade.size };
}

async function writeRow(
  tx: Tx,
  u: CurrentUser,
  kind: ImportKind,
  branchId: string,
  r: CheckedRow,
  o: { source: string; tax: Awaited<ReturnType<typeof getTax>>; pre: { invoice: string; payment: string }; memberPrefix: string; plansMade: Map<string, string> },
) {
  const d = r.data as Record<string, never>;
  if (kind === "members") {
    let planId: string | null = d.planId;
    if (!planId) {
      const key = String(d.planName).toLowerCase();
      planId = o.plansMade.get(key) ?? null;
      if (!planId) {
        const p = await tx.membershipPlan.create({ data: { orgId: u.orgId, name: d.planName, months: d.months, price: d.amount, regFee: 0, gstApplicable: false, kind: "Membership", description: "Created during migration", features: [] } });
        await audit(tx, { orgId: u.orgId, userId: u.id, action: "plan.create", entity: "MembershipPlan", entityId: p.id, after: p });
        o.plansMade.set(key, p.id);
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
        createdById: u.id,
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
    const inv = await writeInvoice(tx, u, {
      branchId: member.branchId,
      memberId: member.id,
      date: d.date,
      dueDate: d.date,
      lines: [{ description: `${d.desc} (migrated receipt${d.txn ? ` ${d.txn}` : ""})`, category: "Other", qty: 1, rate: d.amount, discount: 0, taxRate: 0 }],
      prefix: o.pre.invoice,
      tax: { ...o.tax, enabled: false },
    });
    await writePayment(tx, u, { branchId: member.branchId, memberId: member.id, invoiceId: inv.id, date: d.date, amount: d.amount, method: d.method, txnRef: d.txn ?? undefined, notes: `Migrated receipt from ${o.source}`, prefix: o.pre.payment });
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
