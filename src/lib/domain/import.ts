// Migration from other gym software: CSV parsing, column auto-mapping and per-row checks.
// Pure functions; the importer service supplies what's already in the database as `Ctx`.

import { addDays, addMonths } from "./dates";
import { ASSET_CATEGORIES, depDefault } from "./assets";

export const IMPORT_KINDS = ["members", "payments", "expenses", "products", "assets"] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];

/** [key, label, required, header synonyms] */
type FieldDef = readonly [string, string, boolean, readonly string[]];

export const IMPORTS: Record<ImportKind, { label: string; blurb: string; fields: readonly FieldDef[]; sample: string }> = {
  members: {
    label: "Members",
    blurb: "Your member list with current plan, start and expiry. Plans that don't exist yet are created.",
    fields: [
      ["name", "Name", true, ["name", "member name", "full name", "customer", "client"]],
      ["phone", "Phone", true, ["phone", "mobile", "mobile no", "contact", "whatsapp", "number"]],
      ["email", "Email", false, ["email", "e mail", "mail"]],
      ["gender", "Gender", false, ["gender", "sex"]],
      ["dob", "Date of birth", false, ["dob", "date of birth", "birthday", "birth date"]],
      ["oldId", "Old member ID", false, ["id", "member id", "membership id", "member no", "code", "client id"]],
      ["plan", "Plan", false, ["plan", "package", "membership", "plan name", "scheme"]],
      ["months", "Plan months", false, ["months", "duration", "duration months", "period", "validity"]],
      ["start", "Start date", false, ["start", "start date", "joining", "joining date", "joined", "from", "date of joining", "doj"]],
      ["end", "Expiry date", false, ["end", "end date", "expiry", "expiry date", "valid till", "valid upto", "to", "renewal date"]],
      ["amount", "Plan amount", false, ["amount", "fee", "fees", "price", "total", "plan amount", "package amount"]],
      ["paid", "Amount paid", false, ["paid", "amount paid", "received", "collected"]],
      ["due", "Balance due", false, ["due", "balance", "pending", "outstanding", "balance due"]],
      ["address", "Address", false, ["address", "addr", "street", "locality"]],
      ["city", "City", false, ["city", "town"]],
      ["pin", "PIN code", false, ["pin", "pincode", "pin code", "postal code", "zip"]],
      ["notes", "Notes", false, ["notes", "remarks", "comment", "comments"]],
    ],
    sample:
      'Member ID,Name,Mobile,Gender,Plan,Duration,Start Date,Expiry Date,Fees,Paid,Balance,Address,City\nM-101,Ravi Kumar,9876543210,Male,Gold Quarterly,3,01-07-2026,30-09-2026,4500,4500,0,"Qr. 12/B, Sector 4",Bokaro\nM-102,Sita Devi,9123456780,Female,Monthly,1,15-09-2026,14-10-2026,1500,1000,500,Chas,Bokaro\n',
  },
  payments: {
    label: "Payment history",
    blurb: "Past receipts, so members see their history and revenue reports start from day one. Import members first.",
    fields: [
      ["phone", "Member phone", false, ["phone", "mobile", "mobile no", "contact", "member phone"]],
      ["oldId", "Old member ID", false, ["member id", "id", "membership id", "member no", "client id"]],
      ["name", "Member name", false, ["name", "member", "member name", "customer"]],
      ["date", "Date", true, ["date", "payment date", "receipt date", "paid on", "txn date"]],
      ["amount", "Amount", true, ["amount", "paid", "received", "total", "fee"]],
      ["method", "Method", false, ["method", "mode", "payment mode", "payment method", "via", "type"]],
      ["txn", "Reference", false, ["reference", "ref", "txn", "transaction id", "utr", "receipt no", "receipt"]],
      ["desc", "For", false, ["for", "description", "purpose", "plan", "package", "particulars"]],
    ],
    sample: "Receipt No,Member ID,Mobile,Date,Amount,Mode,Particulars\nR-2201,M-101,9876543210,01-07-2026,4500,UPI,Gold Quarterly\nR-2202,M-102,9123456780,15-09-2026,1000,Cash,Monthly part payment\n",
  },
  expenses: {
    label: "Expenses",
    blurb: "Rent, salaries and bills. Categories are matched to Fitron's; unknown ones go to Miscellaneous.",
    fields: [
      ["date", "Date", true, ["date", "expense date", "paid on", "bill date"]],
      ["category", "Category", false, ["category", "head", "type", "account", "expense head", "ledger"]],
      ["desc", "Description", false, ["description", "particulars", "details", "narration", "desc", "remarks"]],
      ["vendor", "Vendor", false, ["vendor", "paid to", "party", "supplier", "payee"]],
      ["amount", "Amount", true, ["amount", "total", "debit", "value"]],
      ["method", "Method", false, ["method", "mode", "payment mode", "via"]],
      ["bill", "Bill no.", false, ["bill", "bill no", "invoice no", "voucher", "voucher no", "ref"]],
    ],
    sample: "Date,Head,Particulars,Paid To,Amount,Mode,Voucher\n05-08-2026,Rent,August rent,Shri Verma,45000,Bank Transfer,V-118\n12-08-2026,Electricity,JBVNL bill,JBVNL,8200,UPI,V-119\n",
  },
  products: {
    label: "Products & stock",
    blurb: "Supplements, drinks and merchandise with current stock, so the counter is ready to sell.",
    fields: [
      ["name", "Product", true, ["product", "name", "item", "item name", "product name"]],
      ["category", "Category", false, ["category", "type", "group"]],
      ["price", "Selling price", true, ["price", "selling price", "mrp", "rate", "sale price"]],
      ["cost", "Cost price", false, ["cost", "cost price", "purchase price", "buy price"]],
      ["stock", "Stock", false, ["stock", "qty", "quantity", "in stock", "closing stock", "balance"]],
      ["reorder", "Reorder level", false, ["reorder", "reorder level", "min stock", "minimum"]],
      ["sku", "SKU or barcode", false, ["barcode", "ean", "sku", "code"]],
    ],
    sample: "Item,Category,MRP,Cost,Closing Stock,Barcode\nWhey Protein 1kg,Supplements,2800,2100,12,8901234567890\nEnergy Drink,Drinks,80,55,48,\n",
  },
  assets: {
    label: "Equipment & assets",
    blurb: "Your fixed-asset register, so depreciation continues from where your old books left off.",
    fields: [
      ["name", "Asset", true, ["asset", "name", "equipment", "item", "description"]],
      ["category", "Category", false, ["category", "type", "class", "group"]],
      ["qty", "Quantity", false, ["qty", "quantity", "nos", "units"]],
      ["purchaseDate", "Purchase date", true, ["purchase date", "date", "bought on", "date of purchase", "acquired"]],
      ["cost", "Cost", true, ["cost", "amount", "value", "purchase cost", "price"]],
      ["vendor", "Supplier", false, ["vendor", "supplier", "purchased from", "party"]],
      ["method", "Method (WDV/SLM)", false, ["method", "dep method", "depreciation method"]],
      ["rate", "WDV rate %", false, ["rate", "dep rate", "depreciation rate", "rate %"]],
      ["life", "Life (years)", false, ["life", "useful life", "years", "life years"]],
      ["accDep", "Depreciation charged so far", false, ["accumulated depreciation", "acc dep", "depreciation to date", "accumulated"]],
      ["serial", "Serial no.", false, ["serial", "serial no", "model", "model no"]],
    ],
    sample: "Asset,Category,Qty,Purchase Date,Cost,Supplier,Method,Rate,Accumulated Depreciation\nCommercial treadmill,Cardio equipment,2,10-05-2024,320000,Cybex India,WDV,15,86000\nSplit AC 2 ton,Air conditioning,3,10-05-2024,135000,Croma,WDV,15,\n",
  },
};

export const MAX_ROWS = 5000;

/** RFC 4180 CSV: quoted fields, doubled quotes, commas and newlines inside quotes, CRLF, a BOM. */
export function parseCsv(text: string): string[][] {
  const s = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (q) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else q = false;
      } else field += c;
    } else if (c === '"') q = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((x) => x.trim() !== ""));
}

const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9%]+/g, " ").trim();

/** Header index for each field (-1 when not found): exact label or synonym first, then a looser contains-match. */
export function autoMap(kind: ImportKind, headers: string[]): Record<string, number> {
  const hs = headers.map(norm);
  const map: Record<string, number> = {};
  const used = new Set<number>();
  const fields = IMPORTS[kind].fields;
  for (const [key, label, , syn] of fields) {
    const idx = hs.findIndex((h, i) => !used.has(i) && (h === norm(label) || syn.includes(h)));
    map[key] = idx;
    if (idx >= 0) used.add(idx);
  }
  for (const [key, , , syn] of fields) {
    if (map[key]! >= 0) continue;
    const idx = hs.findIndex((h, i) => !used.has(i) && syn.some((sy) => sy.length > 3 && h.includes(sy)));
    map[key] = idx;
    if (idx >= 0) used.add(idx);
  }
  return map;
}

const pad = (n: number) => String(n).padStart(2, "0");
const MON: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };

function valid(y: number, m: number, d: number) {
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1) return "";
  const iso = `${y}-${pad(m)}-${pad(d)}`;
  const dt = new Date(`${iso}T00:00:00Z`);
  return dt.getUTCMonth() + 1 === m ? iso : "";
}

/** DD-MM-YYYY (Indian order), DD/MM/YY, YYYY-MM-DD, "12 Aug 2026", or an Excel serial day number → YYYY-MM-DD, or "". */
export function parseDate(v: string): string {
  const s = v.trim();
  if (!s) return "";
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/))) return valid(+m[1]!, +m[2]!, +m[3]!);
  if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/))) {
    let y = +m[3]!;
    if (y < 100) y += 2000;
    return valid(y, +m[2]!, +m[1]!);
  }
  if ((m = s.match(/^(\d{1,2})(?:st|nd|rd|th)?[\s-]+([a-z]{3,9})[\s,-]+(\d{2,4})$/i))) {
    let y = +m[3]!;
    if (y < 100) y += 2000;
    const mo = MON[m[2]!.toLowerCase().slice(0, 4)] ?? MON[m[2]!.toLowerCase().slice(0, 3)];
    return mo ? valid(y, mo, +m[1]!) : "";
  }
  if ((m = s.match(/^([a-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})$/i))) {
    const mo = MON[m[1]!.toLowerCase().slice(0, 3)];
    return mo ? valid(+m[3]!, mo, +m[2]!) : "";
  }
  if (/^\d{5}$/.test(s)) {
    // Excel serial date (days since 1899-12-30).
    const d = new Date(Date.UTC(1899, 11, 30) + Number(s) * 86_400_000);
    return d.toISOString().slice(0, 10);
  }
  return "";
}

/** "₹1,499.50" → 149950 paise; "" → null. */
export function parsePaise(v: string): number | null {
  const s = v.replace(/[₹,\s]|rs\.?|inr/gi, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

export function parseMethod(v: string) {
  const s = v.toLowerCase();
  if (/upi|gpay|google pay|phonepe|paytm|bhim/.test(s)) return "UPI";
  if (/cash/.test(s)) return "Cash";
  if (/card|pos|debit|credit/.test(s)) return "Card";
  if (/bank|neft|imps|rtgs|transfer|cheque|check/.test(s)) return "Bank Transfer";
  return s ? "Other" : "Cash";
}

/** Months from a duration column, or from a plan name like "Quarterly" or "6 months". 0 when unknown. */
export function planMonths(plan: string, months: string) {
  const n = Number(months.replace(/[^\d.]/g, ""));
  if (n > 0) return Math.round(n);
  const p = plan.toLowerCase();
  let m: RegExpMatchArray | null;
  if ((m = p.match(/(\d+)\s*(m|mo|mon|month)/))) return +m[1]!;
  if ((m = p.match(/(\d+)\s*(y|yr|year)/))) return +m[1]! * 12;
  if (/annual|yearly|year/.test(p)) return 12;
  if (/half/.test(p)) return 6;
  if (/quarter/.test(p)) return 3;
  if (/month/.test(p)) return 1;
  return 0;
}

export const phone10 = (v: string) => v.replace(/\D/g, "").slice(-10);

/** Expense category name → one of the given categories' ids (matched by name, then by keyword). */
export function matchExpenseCategory(v: string, cats: { id: string; name: string }[]) {
  const s = v.toLowerCase().trim();
  const byName = (n: string) => cats.find((c) => c.name.toLowerCase() === n.toLowerCase())?.id;
  if (s) {
    const exact = byName(s) ?? cats.find((c) => c.name.toLowerCase().includes(s) || s.includes(c.name.toLowerCase().split(" ")[0]!))?.id;
    if (exact) return exact;
  }
  const kw: [RegExp, string][] = [
    [/trainer/, "Trainer Salary"],
    [/salary|wages|staff/, "Staff Salary"],
    [/electric|power|bijli/, "Electricity"],
    [/rent/, "Rent"],
    [/water/, "Water"],
    [/net|wifi|broadband/, "Internet"],
    [/advert/, "Advertising"],
    [/market|promo|ads?\b/, "Marketing"],
    [/clean|housekeep/, "Cleaning"],
    [/repair/, "Repairs"],
    [/maint|service/, "Equipment Maintenance"],
    [/software|app|subscription/, "Software"],
    [/stock|inventory|supplement/, "Inventory"],
    [/office|stationery/, "Office Expenses"],
  ];
  for (const [re, name] of kw) if (re.test(s)) return byName(name)!;
  return byName("Miscellaneous")!;
}

export function matchProductCategory(cat: string, name: string) {
  const known = ["Supplements", "Drinks", "Apparel", "Accessories", "Services", "Other"];
  const c = cat.toLowerCase().trim();
  const hit = known.find((k) => k.toLowerCase() === c || (c.length >= 4 && k.toLowerCase().startsWith(c.slice(0, 4))));
  if (hit) return hit;
  const t = `${c} ${name.toLowerCase()}`;
  if (/protein|whey|creat|supp|nutri|bcaa|gainer/.test(t)) return "Supplements";
  if (/shirt|tee|short|wear|apparel|cloth|cap/.test(t)) return "Apparel";
  if (/drink|water|juice|shake|energy|bar\b/.test(t)) return "Drinks";
  if (/pass|session|service/.test(t)) return "Services";
  return "Accessories";
}

export function matchAssetCategory(cat: string, name: string): (typeof ASSET_CATEGORIES)[number] {
  const hit = ASSET_CATEGORIES.find((x) => x.toLowerCase() === cat.toLowerCase().trim());
  if (hit) return hit;
  const t = `${cat} ${name}`.toLowerCase();
  if (/tread|cycle|bike|cross|ellip|rower|cardio|stepper|spin/.test(t)) return "Cardio equipment";
  if (/dumb|plate|barbell|kettle|weight/.test(t)) return "Free weights";
  if (/\bac\b|air con|cooler|split/.test(t)) return "Air conditioning";
  if (/computer|laptop|printer|\btv\b|speaker|camera|biometric|cctv|electron/.test(t)) return "Electronics & computers";
  if (/software|licen/.test(t)) return "Software & licences";
  if (/chair|table|locker|mirror|furnit|sofa|counter/.test(t)) return "Furniture & fixtures";
  if (/machine|press|smith|cable|rig|station|strength|multi|rack|bench/.test(t)) return "Strength equipment";
  if (/car|bike|scooter|vehicle/.test(t)) return "Vehicles";
  return "Other";
}

/** What's already in the database, so rows can be checked against it. */
export type Ctx = {
  today: string;
  phones: Set<string>;
  /** phone → member id, and old ID → member id, for payments */
  memberByPhone: Map<string, string>;
  memberByOldId: Map<string, string>;
  memberByName: Map<string, string[]>;
  plans: { id: string; name: string; months: number; price: number }[];
  productNames: Set<string>;
  productSkus: Set<string>;
  expenseCats: { id: string; name: string }[];
  lockedMonths: Set<string>;
  /** Old ID → member already imported */
  oldIds: Set<string>;
  /** Settings › Reminders: months assumed when a member row has neither expiry nor duration. */
  defaultMonths?: number;
};

export type CheckedRow = { n: number; errors: string[]; warnings: string[]; data: Record<string, unknown>; raw: Record<string, string> };

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const lockMsg = (d: string) => `${MONTH_NAMES[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)} is locked`;

/** Check every row. Rows with errors are skipped on import; warnings say what Fitron assumed. */
export function checkRows(kind: ImportKind, rows: Record<string, string>[], ctx: Ctx): CheckedRow[] {
  const seen = new Set<string>();
  return rows.map((raw, i) => {
    const o = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, (v ?? "").trim()])) as Record<string, string>;
    const errors: string[] = [];
    const warnings: string[] = [];
    const g = (k: string) => o[k] ?? "";
    let data: Record<string, unknown> = {};

    if (kind === "members") {
      const phone = phone10(g("phone"));
      if (!g("name")) errors.push("Name missing");
      if (!/^[6-9]\d{9}$/.test(phone)) errors.push("Invalid mobile number");
      else if (ctx.phones.has(phone)) errors.push("Already a member (skipped)");
      else if (seen.has(phone)) errors.push("Repeated in this file");
      seen.add(phone);
      if (g("oldId") && ctx.oldIds.has(g("oldId"))) errors.push("Old ID already imported");
      let months = planMonths(g("plan"), g("months"));
      let start = parseDate(g("start"));
      let end = parseDate(g("end"));
      if (g("start") && !start) errors.push(`Can't read start date "${g("start")}"`);
      if (g("end") && !end) errors.push(`Can't read expiry date "${g("end")}"`);
      if (!start && end && months) start = addDays(addMonths(end, -months), 1);
      if (!start) {
        start = ctx.today;
        warnings.push("No start date; today assumed");
      }
      if (!end && !months) {
        months = ctx.defaultMonths ?? 1;
        warnings.push(`No expiry or duration; ${months} month${months === 1 ? "" : "s"} assumed`);
      }
      if (!end) end = addDays(addMonths(start, months), -1);
      if (end < start) errors.push("Expiry is before the start");
      if (!months) months = Math.max(1, Math.round((new Date(end).getTime() - new Date(start).getTime()) / (30.4 * 86_400_000)));
      const plan = ctx.plans.find((p) => p.name.toLowerCase() === g("plan").toLowerCase());
      const planName = plan?.name ?? (g("plan") || (months === 12 ? "Yearly" : months === 6 ? "Half-yearly" : months === 3 ? "Quarterly" : months === 1 ? "Monthly" : `${months} months`));
      if (!plan) warnings.push(`Plan "${planName}" will be created`);
      const amount = parsePaise(g("amount")) ?? plan?.price ?? 0;
      const paidRaw = parsePaise(g("paid"));
      const dueRaw = parsePaise(g("due"));
      const paid = Math.min(amount, Math.max(0, paidRaw ?? (dueRaw != null ? amount - dueRaw : amount)));
      const invDate = start <= ctx.today ? start : ctx.today;
      if (ctx.lockedMonths.has(invDate.slice(0, 7))) errors.push(lockMsg(invDate));
      const dob = parseDate(g("dob"));
      data = {
        name: g("name"),
        phone,
        email: g("email") || null,
        gender: /^f/i.test(g("gender")) ? "Female" : /^m/i.test(g("gender")) ? "Male" : "Other",
        dob: dob || null,
        oldId: g("oldId") || null,
        planId: plan?.id ?? null,
        planName,
        months,
        start,
        end,
        amount,
        paid,
        invDate,
        house: g("address") || null,
        city: g("city") || null,
        pin: g("pin").replace(/\D/g, "") || null,
        notes: g("notes") || null,
      };
    }

    if (kind === "payments") {
      const phone = phone10(g("phone"));
      const byName = g("name") ? ctx.memberByName.get(g("name").toLowerCase()) : undefined;
      const memberId = (phone && ctx.memberByPhone.get(phone)) || (g("oldId") && ctx.memberByOldId.get(g("oldId"))) || (byName?.length === 1 ? byName[0] : undefined);
      if (!memberId) errors.push(byName && byName.length > 1 ? "Several members have this name; add the phone" : "Member not found (import members first)");
      const date = parseDate(g("date"));
      if (!date) errors.push(`Can't read date "${g("date")}"`);
      else if (date > ctx.today) errors.push("Date is in the future");
      else if (ctx.lockedMonths.has(date.slice(0, 7))) errors.push(lockMsg(date));
      const amount = parsePaise(g("amount")) ?? 0;
      if (amount <= 0) errors.push("Amount missing");
      data = { memberId, date, amount, method: parseMethod(g("method")), txn: g("txn") || null, desc: g("desc") || "Payment" };
    }

    if (kind === "expenses") {
      const date = parseDate(g("date"));
      if (!date) errors.push(`Can't read date "${g("date")}"`);
      else if (date > ctx.today) errors.push("Date is in the future");
      else if (ctx.lockedMonths.has(date.slice(0, 7))) errors.push(lockMsg(date));
      const amount = parsePaise(g("amount")) ?? 0;
      if (amount <= 0) errors.push("Amount missing");
      const categoryId = matchExpenseCategory(g("category"), ctx.expenseCats);
      const catName = ctx.expenseCats.find((c) => c.id === categoryId)?.name ?? "";
      if (g("category") && catName.toLowerCase() !== g("category").toLowerCase()) warnings.push(`"${g("category")}" filed under ${catName}`);
      data = { date, amount, categoryId, description: g("desc") || `${catName}${g("vendor") ? ` · ${g("vendor")}` : ""}`, vendor: g("vendor") || null, method: parseMethod(g("method")), billNo: g("bill") || null };
    }

    if (kind === "products") {
      if (!g("name")) errors.push("Name missing");
      else if (ctx.productNames.has(g("name").toLowerCase()) || seen.has(g("name").toLowerCase())) errors.push("Product already exists");
      seen.add(g("name").toLowerCase());
      const price = parsePaise(g("price")) ?? 0;
      if (price <= 0) errors.push("Price missing");
      const stockN = Number(g("stock").replace(/[^\d.-]/g, "") || "0");
      const stock = Number.isFinite(stockN) ? Math.max(0, Math.round(stockN)) : 0;
      const sku = (g("sku") || g("name").toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 20)).toUpperCase();
      if (sku && ctx.productSkus.has(sku)) errors.push(`SKU ${sku} already exists`);
      ctx.productSkus.add(sku);
      const reorder = Number(g("reorder").replace(/\D/g, "")) || Math.max(2, Math.round(stock / 5));
      data = { name: g("name"), category: matchProductCategory(g("category"), g("name")), price, cost: parsePaise(g("cost")) ?? 0, stock, reorder, sku };
    }

    if (kind === "assets") {
      if (!g("name")) errors.push("Name missing");
      const purchaseDate = parseDate(g("purchaseDate"));
      if (!purchaseDate) errors.push(`Can't read purchase date "${g("purchaseDate")}"`);
      else if (purchaseDate > ctx.today) errors.push("Purchase date is in the future");
      const cost = parsePaise(g("cost")) ?? 0;
      if (cost <= 0) errors.push("Cost missing");
      const category = matchAssetCategory(g("category"), g("name"));
      const [dr, dl] = depDefault(category);
      const method = /slm|straight/i.test(g("method")) ? "SLM" : "WDV";
      const rate = Number(g("rate").replace(/[^\d.]/g, "")) || dr;
      const life = Math.round(Number(g("life").replace(/[^\d.]/g, ""))) || dl;
      const accDep = parsePaise(g("accDep")) ?? 0;
      if (accDep >= cost && cost > 0) errors.push("Depreciation so far is more than the cost");
      if (!g("rate") && method === "WDV") warnings.push(`Rate ${dr}% assumed`);
      data = { name: g("name"), category, qty: Math.max(1, Math.round(Number(g("qty").replace(/\D/g, "")) || 1)), purchaseDate, cost, vendor: g("vendor") || null, method, rate, life, accDep, serial: g("serial") || null };
    }

    return { n: i + 2, errors, warnings, data, raw: o };
  });
}
