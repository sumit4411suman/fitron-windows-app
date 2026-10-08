// Settings › Backup: the file format of a gym's backup and the pure helpers around it.
// A backup is one JSON file holding every table of one gym (src/lib/services/backup.ts reads and
// writes it). Rows are plain JSON: dates as ISO strings, decimals as strings, bytes as {"$bytes"}.

/** Version of the file format; a file with a higher number needs a newer Fitron. */
export const BACKUP_FORMAT = 1;

export type TableSpec = {
  /** Prisma model name, also the key under `tables` in the file. */
  name: string;
  /** Fields that reference a row of another exported table (foreign keys); used for the insert order check and to refuse inconsistent files. */
  refs?: Record<string, string>;
  /** Columns to order by when reading in pages (the primary key). */
  order?: string[];
  /** Fields holding bytes, decimals or JSON. */
  bytes?: string[];
  decimal?: string[];
  json?: string[];
  /** Fields removed on export (secrets). */
  strip?: string[];
  /** Exported for the record but never written back. */
  exportOnly?: boolean;
};

/**
 * Every table in a backup, in insert order: a table comes after every table it references, so a
 * restore can insert top to bottom and delete bottom to top.
 */
export const BACKUP_TABLES: TableSpec[] = [
  { name: "Branch" },
  { name: "User", strip: ["passwordHash"] },
  { name: "UserBranch", refs: { userId: "User", branchId: "Branch" }, order: ["userId", "branchId"] },
  { name: "Setting", json: ["value"], order: ["key"] },
  { name: "Sequence", order: ["name"] },
  { name: "MonthLock", refs: { branchId: "Branch" }, order: ["branchId", "month"] },
  { name: "MembershipPlan" },
  { name: "PlanPrice", refs: { planId: "MembershipPlan" }, order: ["planId", "category"] },
  { name: "WorkoutPlan", json: ["days"] },
  { name: "DietPlan", json: ["meals"] },
  { name: "Member", refs: { branchId: "Branch", workoutPlanId: "WorkoutPlan", dietPlanId: "DietPlan" } },
  { name: "Offer" },
  { name: "Invoice", refs: { branchId: "Branch", memberId: "Member" }, decimal: ["gstRate"] },
  { name: "InvoiceItem", refs: { invoiceId: "Invoice" }, decimal: ["taxRate"] },
  { name: "Membership", refs: { memberId: "Member", planId: "MembershipPlan", branchId: "Branch", invoiceId: "Invoice" } },
  { name: "Payment", refs: { branchId: "Branch", invoiceId: "Invoice", memberId: "Member" } },
  { name: "Purchase", refs: { branchId: "Branch" } },
  { name: "Expense", refs: { branchId: "Branch", purchaseId: "Purchase" } },
  { name: "PurchaseLine", refs: { purchaseId: "Purchase" }, decimal: ["gstPct"] },
  { name: "VendorPayment", refs: { purchaseId: "Purchase" } },
  { name: "Asset", refs: { branchId: "Branch" }, decimal: ["rate"] },
  { name: "Product", refs: { branchId: "Branch" } },
  { name: "StockMovement", refs: { productId: "Product" } },
  { name: "Lead", refs: { branchId: "Branch", memberId: "Member" } },
  { name: "ClassSlot", refs: { branchId: "Branch" } },
  { name: "Booking", refs: { classSlotId: "ClassSlot", memberId: "Member" } },
  { name: "Attendance", refs: { branchId: "Branch", memberId: "Member" } },
  { name: "ProgressLog", refs: { memberId: "Member" }, decimal: ["weightKg", "bodyFat", "waistCm"] },
  { name: "MembershipFreeze" },
  { name: "WhatsAppTemplate" },
  { name: "WhatsAppMessage", refs: { memberId: "Member" } },
  { name: "AutopayMandate", refs: { memberId: "Member" } },
  { name: "AutopayEvent", refs: { mandateId: "AutopayMandate" }, json: ["payload"] },
  { name: "Notification" },
  { name: "AiProposal" },
  { name: "MemberDocument" },
  { name: "Device" },
  { name: "DeviceCommand", refs: { deviceId: "Device" } },
  { name: "DeviceUser", refs: { deviceId: "Device" }, order: ["deviceId", "memberId"] },
  { name: "BiometricTemplate", bytes: ["data"] },
  { name: "AccessLog", refs: { deviceId: "Device" } },
  { name: "AuditLog", json: ["before", "after"], exportOnly: true },
];

/** The tables a restore writes, in insert order. */
export const RESTORE_TABLES = BACKUP_TABLES.filter((t) => !t.exportOnly);

export type Row = Record<string, unknown>;

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const isDecimalLike = (v: unknown): v is { toString(): string } =>
  typeof v === "object" && v !== null && !(v instanceof Date) && !Array.isArray(v) && typeof (v as { toFixed?: unknown }).toFixed === "function";

const toBase64 = (b: Uint8Array) => Buffer.from(b).toString("base64");
const fromBase64 = (s: string) => new Uint8Array(Buffer.from(s, "base64"));

/** A database row as plain JSON: Date → ISO, Decimal → string, bytes → {"$bytes"}, BigInt → string. JSON columns pass through. */
export function encodeRow(row: Row, spec: TableSpec = { name: "" }): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) {
    if (spec.strip?.includes(k)) continue;
    if (v === null || v === undefined) out[k] = null;
    else if (spec.json?.includes(k)) out[k] = v;
    else if (v instanceof Date) out[k] = v.toISOString();
    else if (typeof v === "bigint") out[k] = v.toString();
    else if (v instanceof Uint8Array) out[k] = { $bytes: toBase64(v) };
    else if (spec.decimal?.includes(k) || isDecimalLike(v)) out[k] = String(v);
    else out[k] = v;
  }
  return out;
}

/** The reverse of encodeRow: ISO strings → Date, {"$bytes"} → Uint8Array; decimals stay strings (the database takes them). */
export function decodeRow(row: Row, spec: TableSpec = { name: "" }): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) {
    if (spec.strip?.includes(k)) continue;
    if (v === null || v === undefined) out[k] = null;
    else if (spec.json?.includes(k)) out[k] = v;
    else if (typeof v === "string" && ISO.test(v)) out[k] = new Date(v);
    else if (typeof v === "object" && !Array.isArray(v) && typeof (v as { $bytes?: unknown }).$bytes === "string") out[k] = fromBase64((v as { $bytes: string }).$bytes);
    else out[k] = v;
  }
  return out;
}

export type BackupFile = {
  app: "fitron";
  format: number;
  exportedAt: string;
  org: { id: string; name?: string; plan?: string; planCycle?: string; trialEndsAt?: string | null; trainerCode?: string | null };
  tables: Record<string, Row[]>;
  counts: Record<string, number>;
};

/** The parsed file when it is a Fitron backup, else null. A newer `format` is returned as-is for the caller to refuse. */
export function parseBackup(text: string): BackupFile | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
  const d = data as Partial<BackupFile>;
  if (d.app !== "fitron" || !Number.isInteger(d.format)) return null;
  if (typeof d.org !== "object" || d.org === null || typeof d.org.id !== "string") return null;
  if (typeof d.tables !== "object" || d.tables === null) return null;
  const members = d.tables.Member;
  if (!Array.isArray(members) || !members.every((m) => typeof m === "object" && m !== null && typeof (m as Row).id === "string")) return null;
  return { ...d, exportedAt: typeof d.exportedAt === "string" ? d.exportedAt : "", counts: typeof d.counts === "object" && d.counts ? d.counts : {} } as BackupFile;
}

const num = (n: number | undefined) => (n ?? 0).toLocaleString("en-IN");

/** "60 members · 67 invoices · 58 payments" */
export const summarise = (counts: Record<string, number | undefined>) => `${num(counts.members)} members · ${num(counts.invoices)} invoices · ${num(counts.payments)} payments`;

const IST_MS = 330 * 60_000;
const istDay = (d: Date) => Math.floor((d.getTime() + IST_MS) / 86_400_000);

/** How long ago, in Indian calendar days: "Today", "Yesterday", "5 days ago". */
export function ageText(at: Date, now = new Date()) {
  const days = istDay(now) - istDay(at);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  return `${days} days ago`;
}

/** Whole Indian calendar days since `at`. */
export const daysSince = (at: Date, now = new Date()) => Math.max(0, istDay(now) - istDay(at));

/** "0 KB", "1 KB", "2.5 MB" */
export function sizeText(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${bytes === 0 ? 0 : Math.max(1, Math.round(bytes / 1024))} KB`;
}

export const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "gym";

/** fitron-backup-power-haus-gym-2026-10-04-1830.json (Indian time). */
export function backupFileName(gymName: string, at: Date) {
  const ist = new Date(at.getTime() + IST_MS).toISOString();
  return `fitron-backup-${slugify(gymName)}-${ist.slice(0, 10)}-${ist.slice(11, 13)}${ist.slice(14, 16)}.json`;
}
