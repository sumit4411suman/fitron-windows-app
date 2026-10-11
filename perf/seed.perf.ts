import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";

// Phase 20's dataset (docs/local-windows/PERFORMANCE.md), built in a FITRON for Windows data folder (PERF_ROOT):
//   5,000 members · 20,000 memberships · 50,000 invoices · 100,000 payments · 20,000 expenses · a large audit log
// The gym, its owner, plans, one member, one sale with its payment and one expense are made by the app's own services.
// Every other row is a copy of those with its own id, number, dates and amounts, written in batches: the same shape the
// app writes, consistent (each invoice's items add up, payments never pass an invoice's total, numbers are unique and the
// counters sit past them), and an audit log whose hash chain verifies.

const root = process.env.PERF_ROOT!;
const SIZE = { members: 5_000, memberships: 20_000, invoices: 50_000, payments: 100_000, expenses: 20_000, audit: 200_000 };
export const OWNER = { email: "owner@perf.fitron.test", password: "Perf-owner-password-1" };

const BATCH = 2_000;
const DAY = 86_400_000;
const FIRST = Date.UTC(2023, 3, 1); // three and a half years of history
const SPAN = Date.UTC(2026, 9, 1) - FIRST;
let seed = 20;
const rand = () => ((seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648) / 2_147_483_648);
const pick = <T>(a: readonly T[]) => a[Math.floor(rand() * a.length)]!;
const dayOf = (t: number) => new Date(Math.floor(t / DAY) * DAY);
const id = () => `p${randomUUID().replace(/-/g, "").slice(0, 24)}`;

const FIRSTS = ["Aarav", "Vivaan", "Aditya", "Vihaan", "Arjun", "Sai", "Reyansh", "Ayaan", "Krishna", "Ishaan", "Ananya", "Diya", "Aadhya", "Saanvi", "Pari", "Anika", "Navya", "Myra", "Riya", "Kavya", "Rohit", "Priya", "Neha", "Rahul", "Pooja", "Amit", "Sneha", "Vikram", "Divya", "Karan"];
const LASTS = ["Sharma", "Verma", "Gupta", "Singh", "Kumar", "Patel", "Reddy", "Nair", "Iyer", "Das", "Mehta", "Joshi", "Rao", "Bose", "Khan", "Yadav", "Mishra", "Pandey", "Chopra", "Kapoor"];
const AREAS = ["Kankarbagh", "Boring Road", "Rajendra Nagar", "Patliputra", "Bailey Road", "Danapur", "Ashok Rajpath", "Frazer Road"];

it("builds the performance dataset", async () => {
  mkdirSync(path.join(root, "data"), { recursive: true });
  const { dataDirs } = await import("@/lib/runtime/paths");
  const dirs = dataDirs(root);
  const { migrateLocal } = await import("@/lib/runtime/local-migrate");
  migrateLocal(dirs.database, path.join(process.cwd(), "prisma", "local-migrations"));
  const { db } = await import("@/lib/db");
  const { createLocalGym } = await import("@/lib/services/local-setup");
  const { systemUser } = await import("@/lib/auth/system");
  const { createPlan } = await import("@/lib/services/plans");
  const { createMember } = await import("@/lib/services/members");
  const { sellMembership } = await import("@/lib/services/billing");
  const { createExpense } = await import("@/lib/services/expenses");
  const { chainHash } = await import("@/lib/domain/audit-chain");
  const { verifyAuditChain } = await import("@/lib/services/audit");
  const started = Date.now();

  const gym = await createLocalGym({ gymName: "Perf Fitness Patna", branchName: "Main", address: "Boring Road, Patna", ownerName: "Perf Owner", email: OWNER.email, phone: "9876500000", password: OWNER.password, confirm: OWNER.password });
  const u = await systemUser(gym.orgId);
  const orgId = gym.orgId;
  const branchId = u.branchIds[0]!;
  const plans = [];
  for (const [name, months, price, gst] of [["Monthly", 1, 150_000, true], ["Quarterly", 3, 400_000, true], ["Half-yearly", 6, 750_000, true], ["Annual", 12, 1_350_000, false]] as const)
    plans.push(await createPlan(u, { name, kind: "Membership", months, price, regFee: 0, discount: 0, gstApplicable: gst, features: [] }));

  // The templates: one of everything, made the way the desk makes it.
  const m0 = await createMember(u, { name: "Template Member", gender: "Male", phone: "9800000000", source: "Walk-in", tags: [] });
  const sale = await sellMembership(u, m0.id, { planId: plans[0]!.id, startDate: "2026-09-01", discount: 0, includeRegFee: false, payAmount: 50_000, payMethod: "UPI" });
  const cat = await db.expenseCategory.findFirstOrThrow();
  await createExpense(u, { date: "2026-09-02", categoryId: cat.id, description: "Template expense", amount: 120_000, method: "Cash" } as never);
  const tMember = await db.member.findUniqueOrThrow({ where: { id: m0.id } });
  const tInvoice = await db.invoice.findUniqueOrThrow({ where: { id: sale.invoice.id } });
  const tItem = await db.invoiceItem.findFirstOrThrow({ where: { invoiceId: tInvoice.id } });
  const tShip = await db.membership.findFirstOrThrow({ where: { invoiceId: tInvoice.id } });
  const tPay = await db.payment.findFirstOrThrow({ where: { invoiceId: tInvoice.id } });
  const tExp = await db.expense.findFirstOrThrow({ where: { orgId } });
  const categories = await db.expenseCategory.findMany({ select: { id: true } });

  const many = async <T>(rows: T[], write: (chunk: T[]) => Promise<unknown>) => {
    for (let i = 0; i < rows.length; i += BATCH) await write(rows.slice(i, i + BATCH));
  };

  // Members.
  const members: { id: string; joined: number }[] = [];
  const memberRows = [];
  for (let i = 1; i < SIZE.members; i++) {
    const joined = FIRST + Math.floor(rand() * SPAN * 0.9);
    const mid = id();
    members.push({ id: mid, joined });
    memberRows.push({ ...tMember, id: mid, code: `FT-${1001 + i}`, name: `${pick(FIRSTS)} ${pick(LASTS)}`, gender: rand() < 0.55 ? "Male" : "Female", phone: `9${String(700_000_000 + i).padStart(9, "0")}`, area: pick(AREAS), createdAt: new Date(joined), updatedAt: new Date(joined) });
  }
  members.unshift({ id: m0.id, joined: Date.UTC(2026, 8, 1) });
  await many(memberRows, (c) => db.member.createMany({ data: c }));

  // Invoices: the first 20,000 sell a membership, the rest are personal training and products. Each has one item.
  const invoices: { id: string; memberId: string; date: number; total: number; cancelled: boolean }[] = [];
  const invRows = [], itemRows = [], shipRows = [];
  for (let i = 1; i < SIZE.invoices; i++) {
    const mem = pick(members);
    const date = Math.min(Date.UTC(2026, 9, 1), mem.joined + Math.floor(rand() * (Date.UTC(2026, 9, 1) - mem.joined)));
    const isShip = i < SIZE.memberships;
    const plan = pick(plans);
    const base = isShip ? plan.price : pick([60_000, 120_000, 250_000, 35_000, 89_900]);
    const gst = isShip ? plan.gstApplicable : true;
    const discount = rand() < 0.15 ? Math.round(base * 0.1) : 0;
    const taxable = base - discount;
    const tax = gst ? Math.round(taxable * 0.18) : 0;
    const total = taxable + tax;
    const cancelled = rand() < 0.01;
    const iid = id();
    invoices.push({ id: iid, memberId: mem.id, date, total, cancelled });
    invRows.push({ ...tInvoice, id: iid, number: `INV-${1001 + i}`, memberId: mem.id, date: dayOf(date), dueDate: dayOf(date + 7 * DAY), subtotal: base, discount, tax, total, gstType: gst ? tInvoice.gstType : null, gstRate: gst ? tInvoice.gstRate : null, status: cancelled ? "CANCELLED" : "ISSUED", cancelReason: cancelled ? "Entered by mistake" : null, cancelledById: cancelled ? u.id : null, cancelledAt: cancelled ? new Date(date + DAY) : null, createdAt: new Date(date), seller: tInvoice.seller ?? undefined });
    itemRows.push({ ...tItem, id: id(), invoiceId: iid, description: isShip ? `${plan.name} membership` : pick(["Personal training (8 sessions)", "Whey protein 1 kg", "Gym gloves", "Shaker", "Diet consultation"]), rate: base, discount, taxRate: gst ? tItem.taxRate : 0, taxAmount: tax, amount: total, category: isShip ? tItem.category : pick(["PT", "Product"]), planId: isShip ? plan.id : null });
    if (isShip) {
      const start = dayOf(date);
      shipRows.push({ ...tShip, id: id(), code: `MS-${1 + i}`, memberId: mem.id, planId: plan.id, invoiceId: iid, startDate: start, endDate: new Date(start.getTime() + plan.months * 30 * DAY), price: plan.price, discount, status: cancelled ? "CANCELLED" : "VALID", createdAt: new Date(date) });
    }
  }
  await many(invRows, (c) => db.invoice.createMany({ data: c as never }));
  await many(itemRows, (c) => db.invoiceItem.createMany({ data: c as never }));
  await many(shipRows, (c) => db.membership.createMany({ data: c }));

  // Payments: about two per invoice, never more than its total. Most invoices end paid, some part paid, some unpaid.
  const payRows = [];
  let n = 1;
  const open = invoices.filter((x) => !x.cancelled);
  for (const inv of open) {
    const r = rand();
    const target = r < 0.8 ? inv.total : r < 0.93 ? Math.floor(inv.total * 0.5) : 0;
    let left = target;
    const parts = target ? 1 + Math.floor(rand() * 4) : 0;
    for (let k = 0; k < parts && left > 0 && payRows.length < SIZE.payments - 1; k++) {
      const amount = k === parts - 1 ? left : Math.max(100, Math.floor(left / (parts - k)));
      left -= amount;
      payRows.push({ ...tPay, id: id(), code: `PAY-${5001 + n++}`, invoiceId: inv.id, memberId: inv.memberId, date: dayOf(inv.date + k * 3 * DAY), amount, method: pick(["Cash", "UPI", "UPI", "Card", "Bank transfer"]), txnRef: null, createdAt: new Date(inv.date + k * 3 * DAY) });
    }
  }
  await many(payRows, (c) => db.payment.createMany({ data: c }));

  // Expenses.
  const expRows = [];
  for (let i = 1; i < SIZE.expenses; i++) {
    const t = FIRST + Math.floor(rand() * SPAN);
    expRows.push({ ...tExp, id: id(), code: `EXP-${1 + i}`, date: dayOf(t), categoryId: pick(categories).id, description: pick(["Electricity bill", "Rent", "Trainer salary advance", "Cleaning supplies", "Equipment repair", "Water cans", "Internet", "Marketing flyers"]), vendor: pick(["BSEB", "Landlord", "Local vendor", null]), amount: pick([25_000, 60_000, 150_000, 4_500_000, 1_200_000, 85_000]), createdAt: new Date(t) });
  }
  await many(expRows, (c) => db.expense.createMany({ data: c }));

  // The audit log, continuing the gym's chain: one entry per payment, invoice and expense written above, and more.
  const last = await db.auditLog.findFirst({ where: { orgId, hash: { not: null } }, orderBy: { id: "desc" } });
  let prev = last!.hash!;
  let at = last!.createdAt.getTime() + 1_000;
  const auditRows = [];
  for (let i = 0; i < SIZE.audit; i++) {
    const kind = i % 4;
    const entity = ["Payment", "Invoice", "Expense", "Member"][kind]!;
    const ref = kind === 0 ? payRows[i % payRows.length]! : kind === 1 ? invRows[i % invRows.length]! : kind === 2 ? expRows[i % expRows.length]! : memberRows[i % memberRows.length]!;
    const e = { orgId, userId: u.id, actorType: "USER", action: `${entity.toLowerCase()}.create`, entity, entityId: ref.id, branchId, createdAt: new Date(at), before: null, after: { id: ref.id, code: (ref as { code?: string; number?: string }).code ?? (ref as { number?: string }).number } };
    const hash = chainHash(prev, e);
    auditRows.push({ ...e, before: undefined, hash, prevHash: prev });
    prev = hash;
    at += 1_000;
  }
  await many(auditRows, (c) => db.auditLog.createMany({ data: c }));

  // The counters, past every number used, so the next sale gets a fresh one.
  for (const [name, next] of [["member", 1001 + SIZE.members + 1], ["invoice", 1001 + SIZE.invoices + 1], ["payment", 5001 + n + 1], ["membership", SIZE.memberships + 2], ["expense", SIZE.expenses + 2]] as const)
    await db.sequence.upsert({ where: { orgId_name: { orgId, name } }, create: { orgId, name, next }, update: { next } });
  await db.$executeRawUnsafe("ANALYZE");

  const counts = {
    members: await db.member.count(),
    memberships: await db.membership.count(),
    invoices: await db.invoice.count(),
    payments: await db.payment.count(),
    expenses: await db.expense.count({ where: { orgId } }),
    audit: await db.auditLog.count(),
  };
  console.log(JSON.stringify({ counts, seconds: Math.round((Date.now() - started) / 1000) }));
  expect(counts.members).toBe(SIZE.members);
  expect(counts.memberships).toBe(SIZE.memberships);
  expect(counts.invoices).toBe(SIZE.invoices);
  expect(counts.payments).toBe(SIZE.payments);
  expect(counts.expenses).toBe(SIZE.expenses);
  expect(counts.audit).toBeGreaterThan(SIZE.audit);
  // Payments never pass an invoice's total.
  const over = await db.$queryRawUnsafe<{ n: number }[]>(`SELECT COUNT(*) AS n FROM (SELECT i.id FROM "Invoice" i JOIN "Payment" p ON p."invoiceId" = i.id GROUP BY i.id, i.total HAVING SUM(p.amount) > i.total)`);
  expect(Number(over[0]!.n)).toBe(0);
  expect((await verifyAuditChain(orgId)).bad).toBe(0);
});
