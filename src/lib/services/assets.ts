import "server-only";
import { db } from "@/lib/db";
import type { CurrentUser } from "@/lib/auth/current";
import { writeBranch } from "@/lib/auth/current";
import type { Prisma } from "@/generated/prisma/client";
import { assetInfo, depDefault, scheduleByFy, ymOf, type AssetLike } from "@/lib/domain/assets";
import { NOT_PAID, type AssetInput, type DisposeInput } from "@/lib/validation/assets";
import { audit } from "./audit";
import { UserError } from "./errors";
import { assertMonthOpen } from "./locks";
import { nextNumber } from "./sequence";
import { fromIso, toIso, todayIso } from "./time";

type Tx = Prisma.TransactionClient;
type AssetRow = Prisma.AssetGetPayload<object>;

export const CAPITAL_CATEGORY = "equipment-purchase";

const scope = (u: CurrentUser): Prisma.AssetWhereInput => ({ orgId: u.orgId, branchId: { in: u.branchIds }, deletedAt: null });

/** The shape the depreciation maths needs. */
export const toLike = (a: AssetRow): AssetLike => ({
  cost: a.cost,
  salvage: a.salvage,
  method: a.method as "WDV" | "SLM",
  rate: a.rate == null ? null : Number(a.rate),
  life: a.life,
  purchaseDate: toIso(a.purchaseDate),
  accDepCarried: a.accDepCarried,
  depFrom: a.depFrom,
  disposedOn: a.disposedOn ? toIso(a.disposedOn) : null,
  disposedFor: a.disposedFor,
});

/** Assets for P&L and reports, limited to the given branches. */
export const assetsFor = (orgId: string, branchIds: string[]) => db.asset.findMany({ where: { orgId, branchId: { in: branchIds }, deletedAt: null } });

export async function listAssets(u: CurrentUser, f: { q?: string; status?: string; category?: string }) {
  const q = f.q?.trim();
  const rows = await db.asset.findMany({
    where: {
      ...scope(u),
      ...(f.status ? { status: f.status } : {}),
      ...(f.category ? { category: f.category } : {}),
      ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { code: { contains: q, mode: "insensitive" } }, { vendor: { contains: q, mode: "insensitive" } }, { serial: { contains: q, mode: "insensitive" } }] } : {}),
    },
    orderBy: [{ purchaseDate: "desc" }, { createdAt: "desc" }],
    include: { branch: { select: { name: true } } },
  });
  const now = ymOf(todayIso());
  return rows.map((a) => ({ ...a, info: assetInfo(toLike(a), now) }));
}

export async function registerTotals(u: CurrentUser) {
  const rows = await listAssets(u, {});
  const inUse = rows.filter((a) => a.status === "IN_USE");
  return {
    count: inUse.length,
    cost: inUse.reduce((s, a) => s + a.cost, 0),
    nbv: inUse.reduce((s, a) => s + a.info.nbv, 0),
    fyDep: rows.reduce((s, a) => s + a.info.fyDep, 0),
  };
}

export async function getAsset(u: CurrentUser, id: string) {
  const a = await db.asset.findFirst({ where: { ...scope(u), id }, include: { branch: { select: { name: true } } } });
  if (!a) return null;
  const now = ymOf(todayIso());
  const like = toLike(a);
  const [expense, purchase] = await Promise.all([
    a.expenseId ? db.expense.findUnique({ where: { id: a.expenseId }, select: { id: true, code: true, method: true, status: true } }) : null,
    a.purchaseId ? db.purchase.findUnique({ where: { id: a.purchaseId }, select: { id: true, code: true } }) : null,
  ]);
  return { ...a, info: assetInfo(like, now), byFy: scheduleByFy(like, now), expense, purchase };
}

function assetData(input: AssetInput) {
  const [rate, life] = depDefault(input.category);
  return {
    name: input.name,
    category: input.category,
    qty: input.qty,
    vendor: input.vendor ?? null,
    purchaseDate: fromIso(input.purchaseDate),
    cost: input.cost,
    salvage: input.salvage,
    method: input.method,
    rate: input.method === "WDV" ? (input.rate ?? rate) : (input.rate ?? null),
    life: input.method === "SLM" ? (input.life ?? life) : (input.life ?? null),
    serial: input.serial ?? null,
    billNo: input.billNo ?? null,
    notes: input.notes ?? null,
  };
}

/** Writes an asset and, when it was paid from the gym's books, its capital expense (cash book only, not P&L). */
export async function writeAsset(
  tx: Tx,
  u: CurrentUser,
  branchId: string,
  data: Omit<ReturnType<typeof assetData>, "category"> & { category: string; accDepCarried?: number; depFrom?: string | null; purchaseId?: string | null },
  pay: { method: string; purchaseId?: string } | null,
) {
  const n = await nextNumber(tx, u.orgId, "asset", 1001);
  const asset = await tx.asset.create({ data: { ...data, orgId: u.orgId, branchId, code: `AST-${n}`, payMethod: pay?.method ?? null, createdById: u.id } });
  let expenseId: string | null = null;
  if (pay) {
    const en = await nextNumber(tx, u.orgId, "expense", 1);
    const e = await tx.expense.create({
      data: {
        code: `EXP-${en}`,
        orgId: u.orgId,
        branchId,
        date: data.purchaseDate,
        categoryId: CAPITAL_CATEGORY,
        description: `Capital purchase · ${data.name}${data.qty > 1 ? ` ×${data.qty}` : ""}`,
        vendor: data.vendor,
        amount: data.cost,
        method: pay.method,
        billNo: data.billNo,
        notes: `Capitalised as ${asset.code}`,
        capital: true,
        assetId: asset.id,
        purchaseId: pay.purchaseId ?? null,
        createdById: u.id,
      },
    });
    expenseId = e.id;
    await audit(tx, { orgId: u.orgId, userId: u.id, action: "expense.create", entity: "Expense", entityId: e.id, after: e });
  }
  const after = expenseId ? await tx.asset.update({ where: { id: asset.id }, data: { expenseId } }) : asset;
  await audit(tx, { orgId: u.orgId, userId: u.id, action: "asset.create", entity: "Asset", entityId: asset.id, after });
  return after;
}

export async function createAsset(u: CurrentUser, input: AssetInput) {
  const branchId = writeBranch(u);
  if (!branchId) throw new UserError("Pick a branch first.");
  return db.$transaction(async (tx) => {
    await assertMonthOpen(tx, u, branchId, input.purchaseDate);
    return writeAsset(tx, u, branchId, assetData(input), input.payMethod === NOT_PAID ? null : { method: input.payMethod });
  });
}

/** Corrections reflow the whole schedule. The linked cash-book expense follows the new cost, date and method. */
export async function updateAsset(u: CurrentUser, id: string, input: AssetInput) {
  const before = await db.asset.findFirst({ where: { ...scope(u), id } });
  if (!before) throw new UserError("Asset not found.");
  if (before.status !== "IN_USE") throw new UserError("A sold or scrapped asset can't be edited.");
  if (before.purchaseId) {
    const changedMoney = before.cost !== input.cost || toIso(before.purchaseDate) !== input.purchaseDate;
    if (changedMoney) throw new UserError("This asset came from a purchase bill. Correct its cost or date on the bill.", "cost");
  }
  return db.$transaction(async (tx) => {
    await assertMonthOpen(tx, u, before.branchId, toIso(before.purchaseDate));
    await assertMonthOpen(tx, u, before.branchId, input.purchaseDate);
    const data = assetData(input);
    let expenseId = before.expenseId;
    const wantsCash = input.payMethod !== NOT_PAID && !before.purchaseId;
    if (before.expenseId && !before.purchaseId) {
      const e = await tx.expense.findUniqueOrThrow({ where: { id: before.expenseId } });
      if (wantsCash) {
        const after = await tx.expense.update({ where: { id: e.id }, data: { date: data.purchaseDate, amount: data.cost, method: input.payMethod, vendor: data.vendor, billNo: data.billNo, description: `Capital purchase · ${data.name}${data.qty > 1 ? ` ×${data.qty}` : ""}` } });
        await audit(tx, { orgId: u.orgId, userId: u.id, action: "expense.update", entity: "Expense", entityId: e.id, before: e, after });
      } else if (e.status === "ACTIVE") {
        const after = await tx.expense.update({ where: { id: e.id }, data: { status: "VOID", voidReason: `Asset ${before.code} marked as not paid from the gym's books` } });
        await audit(tx, { orgId: u.orgId, userId: u.id, action: "expense.void", entity: "Expense", entityId: e.id, before: e, after });
        expenseId = null;
      }
    } else if (!before.expenseId && wantsCash) {
      const en = await nextNumber(tx, u.orgId, "expense", 1);
      const e = await tx.expense.create({
        data: { code: `EXP-${en}`, orgId: u.orgId, branchId: before.branchId, date: data.purchaseDate, categoryId: CAPITAL_CATEGORY, description: `Capital purchase · ${data.name}`, vendor: data.vendor, amount: data.cost, method: input.payMethod, billNo: data.billNo, notes: `Capitalised as ${before.code}`, capital: true, assetId: id, createdById: u.id },
      });
      await audit(tx, { orgId: u.orgId, userId: u.id, action: "expense.create", entity: "Expense", entityId: e.id, after: e });
      expenseId = e.id;
    }
    const after = await tx.asset.update({ where: { id }, data: { ...data, expenseId, payMethod: before.purchaseId ? before.payMethod : input.payMethod === NOT_PAID ? null : input.payMethod } });
    await audit(tx, { orgId: u.orgId, userId: u.id, action: "asset.update", entity: "Asset", entityId: id, before, after });
    return after;
  });
}

/** Sold or scrapped: depreciation stops after this month and the gain or loss lands in P&L. */
export async function disposeAsset(u: CurrentUser, id: string, input: DisposeInput) {
  const before = await db.asset.findFirst({ where: { ...scope(u), id } });
  if (!before) throw new UserError("Asset not found.");
  if (before.status !== "IN_USE") throw new UserError("Already disposed.");
  if (input.date < toIso(before.purchaseDate)) throw new UserError("That's before the purchase date.", "date");
  if (input.date > todayIso()) throw new UserError("The date can't be in the future.", "date");
  const sold = input.type === "SOLD";
  return db.$transaction(async (tx) => {
    await assertMonthOpen(tx, u, before.branchId, input.date);
    const after = await tx.asset.update({
      where: { id },
      data: { status: input.type, disposedOn: fromIso(input.date), disposedFor: sold ? input.amount : 0, disposeMethod: sold && input.amount > 0 ? input.method! : null, disposeNote: input.note ?? null },
    });
    await audit(tx, { orgId: u.orgId, userId: u.id, action: sold ? "asset.sold" : "asset.scrapped", entity: "Asset", entityId: id, before, after });
    return after;
  });
}

/** Undo a disposal entered by mistake. */
export async function undoDisposal(u: CurrentUser, id: string) {
  const before = await db.asset.findFirst({ where: { ...scope(u), id } });
  if (!before || before.status === "IN_USE" || !before.disposedOn) throw new UserError("Nothing to undo.");
  await db.$transaction(async (tx) => {
    await assertMonthOpen(tx, u, before.branchId, toIso(before.disposedOn!));
    const after = await tx.asset.update({ where: { id }, data: { status: "IN_USE", disposedOn: null, disposedFor: null, disposeMethod: null, disposeNote: null } });
    await audit(tx, { orgId: u.orgId, userId: u.id, action: "asset.undo-disposal", entity: "Asset", entityId: id, before, after });
  });
}

/** Remove an asset recorded by mistake. Its cash-book expense is voided with it. */
export async function removeAsset(u: CurrentUser, id: string, reason: string) {
  const before = await db.asset.findFirst({ where: { ...scope(u), id } });
  if (!before) throw new UserError("Asset not found.");
  if (before.purchaseId) throw new UserError("This asset came from a purchase bill. Cancel the bill instead.");
  if (before.status !== "IN_USE") throw new UserError("Undo the disposal first.");
  await db.$transaction(async (tx) => {
    await assertMonthOpen(tx, u, before.branchId, toIso(before.purchaseDate));
    if (before.expenseId) {
      const e = await tx.expense.findUniqueOrThrow({ where: { id: before.expenseId } });
      if (e.status === "ACTIVE") {
        const ea = await tx.expense.update({ where: { id: e.id }, data: { status: "VOID", voidReason: `Asset ${before.code} removed: ${reason}` } });
        await audit(tx, { orgId: u.orgId, userId: u.id, action: "expense.void", entity: "Expense", entityId: e.id, before: e, after: ea });
      }
    }
    const after = await tx.asset.update({ where: { id }, data: { deletedAt: new Date(), notes: [before.notes, `Removed: ${reason}`].filter(Boolean).join("\n") } });
    await audit(tx, { orgId: u.orgId, userId: u.id, action: "asset.remove", entity: "Asset", entityId: id, before, after });
  });
}
