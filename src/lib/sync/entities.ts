// Cloud sync: what syncs between fitron.in and FITRON for Windows, in what order, and how each kind of record behaves
// when both sides changed it (docs/local-windows/SYNC.md §3 and §6). Pure data: the trigger generator, the server and
// the computer's client all read this one table.
//
// Every synced table has database triggers (scripts/sync-schema.ts writes them into the migrations) that record each
// insert, update and delete in SyncChange inside the same transaction as the change itself, so a change is recorded
// exactly when it is committed, whatever code made it.

/**
 * How a record behaves when both sides changed it between syncs:
 *   merge   fields changed on one side only are merged; where both changed the same field, the later confirmed write
 *           wins and both versions are kept in SyncConflict for the owner (members, leads, plans, products…)
 *   server  the website's record stands; the computer's change is kept in SyncConflict (money: invoices, payments,
 *           memberships, expenses…). Updates may only touch the fields in `mutable` (cancel, reverse, void, freeze).
 *   lww     the later confirmed write wins, nothing kept beyond the audit entry (settings, message status)
 *   append  insert-only rows that never change after they are written (invoice lines, stock movements)
 */
export type SyncKind = "merge" | "server" | "lww" | "append";

export type SyncEntity = {
  /** The Prisma model, and the table name. */
  name: string;
  kind: SyncKind;
  /** For a table without its own orgId: the parent table and the field pointing at it, which has one. */
  parent?: [table: string, field: string];
  /** Where clause selecting one gym's rows (the snapshot, and the server's tenant check). */
  orgWhere: (orgId: string) => Record<string, unknown>;
  /** Fields that never leave the side they are on (secrets, sign-in state). */
  omit?: string[];
  /** For kind "server": the only fields an update may change. */
  mutable?: string[];
  /** Setting only: keys that belong to one installation and never sync. */
  skipKeys?: string[];
  /** A delete of this record may be synced (financial records are never deleted; the database refuses it). */
  deletable?: boolean;
};

const byOrg = (orgId: string) => ({ orgId });

/** Settings that describe this installation, not the gym: its WhatsApp transport and keys, its recovery key, its job log. */
export const LOCAL_ONLY_SETTINGS = ["localRecovery", "whatsapp", "whatsapp_cloud", "whatsapp_connector", "wa_auto_runs", "updates"];

/** Parents before children, so a batch applied in this order never breaks a foreign key. */
export const SYNC_ENTITIES: SyncEntity[] = [
  { name: "Branch", kind: "merge", orgWhere: byOrg },
  {
    name: "User",
    kind: "merge",
    orgWhere: byOrg,
    // Passwords, two-step secrets and sign-in times stay on each side; a staff member's role travels by name (roles are
    // a catalogue each database seeds for itself).
    omit: ["passwordHash", "totpSecret", "totpEnabledAt", "totpLastStep", "lastLoginAt", "emailVerifiedAt"],
  },
  { name: "UserBranch", kind: "merge", parent: ["User", "userId"], orgWhere: (orgId) => ({ user: { orgId } }), deletable: true },
  { name: "Setting", kind: "lww", orgWhere: byOrg, skipKeys: LOCAL_ONLY_SETTINGS, deletable: true },
  { name: "MonthLock", kind: "lww", parent: ["Branch", "branchId"], orgWhere: (orgId) => ({ branch: { orgId } }), deletable: true },
  { name: "MembershipPlan", kind: "merge", orgWhere: byOrg },
  { name: "PlanPrice", kind: "lww", parent: ["MembershipPlan", "planId"], orgWhere: (orgId) => ({ plan: { orgId } }), deletable: true },
  { name: "WorkoutPlan", kind: "merge", orgWhere: byOrg, deletable: true },
  { name: "DietPlan", kind: "merge", orgWhere: byOrg, deletable: true },
  { name: "Member", kind: "merge", orgWhere: byOrg },
  { name: "Offer", kind: "merge", orgWhere: byOrg, deletable: true },
  { name: "Invoice", kind: "server", orgWhere: byOrg, mutable: ["status", "cancelReason", "cancelledById", "cancelledAt", "pdfKey"] },
  { name: "InvoiceItem", kind: "append", parent: ["Invoice", "invoiceId"], orgWhere: (orgId) => ({ invoice: { orgId } }) },
  { name: "Membership", kind: "server", parent: ["Branch", "branchId"], orgWhere: (orgId) => ({ branch: { orgId } }), mutable: ["status", "endDate"] },
  { name: "Payment", kind: "server", orgWhere: byOrg, mutable: ["status", "reversedById", "reversedAt", "reverseReason"] },
  { name: "Purchase", kind: "server", orgWhere: byOrg, mutable: ["status", "cancelReason"] },
  {
    name: "Expense",
    kind: "server",
    orgWhere: byOrg,
    // Voids, the payment method of a purchase paid later, and an asset's capital expense when the asset is edited.
    mutable: ["status", "voidReason", "method", "date", "amount", "vendor", "billNo", "description"],
  },
  { name: "PurchaseLine", kind: "append", parent: ["Purchase", "purchaseId"], orgWhere: (orgId) => ({ purchase: { orgId } }) },
  { name: "VendorPayment", kind: "append", parent: ["Purchase", "purchaseId"], orgWhere: (orgId) => ({ purchase: { orgId } }) },
  { name: "SalaryPayment", kind: "server", orgWhere: byOrg, mutable: ["recovered", "settledMonth"] },
  {
    name: "Asset",
    kind: "server",
    orgWhere: byOrg,
    // The asset register is edited in place (Assets › edit, dispose, restore, remove); its money lives in its Expense.
    mutable: ["name", "category", "qty", "vendor", "purchaseDate", "cost", "salvage", "method", "rate", "life", "serial", "billNo", "payMethod", "expenseId", "accDepCarried", "depFrom", "status", "disposedOn", "disposedFor", "disposeMethod", "disposeNote", "notes", "deletedAt"],
  },
  { name: "Product", kind: "merge", orgWhere: byOrg },
  { name: "StockMovement", kind: "append", parent: ["Product", "productId"], orgWhere: (orgId) => ({ product: { orgId } }) },
  { name: "Lead", kind: "merge", orgWhere: byOrg, deletable: true },
  { name: "ClassSlot", kind: "merge", orgWhere: byOrg, deletable: true },
  { name: "Booking", kind: "merge", parent: ["ClassSlot", "classSlotId"], orgWhere: (orgId) => ({ classSlot: { orgId } }), deletable: true },
  { name: "Attendance", kind: "merge", parent: ["Branch", "branchId"], orgWhere: (orgId) => ({ branch: { orgId } }) },
  { name: "ProgressLog", kind: "merge", parent: ["Member", "memberId"], orgWhere: (orgId) => ({ member: { orgId } }), deletable: true },
  { name: "PersonalRecord", kind: "merge", orgWhere: byOrg, deletable: true },
  { name: "MembershipFreeze", kind: "server", orgWhere: byOrg, mutable: ["endedOn"] },
  { name: "WhatsAppTemplate", kind: "merge", orgWhere: byOrg, deletable: true },
  { name: "WhatsAppMessage", kind: "lww", orgWhere: byOrg },
  { name: "AutopayMandate", kind: "lww", orgWhere: byOrg },
  { name: "AutopayEvent", kind: "lww", parent: ["AutopayMandate", "mandateId"], orgWhere: (orgId) => ({ mandate: { orgId } }) },
  { name: "Notification", kind: "lww", orgWhere: byOrg, deletable: true },
  { name: "MemberDocument", kind: "merge", orgWhere: byOrg, deletable: true },
];

export const SYNC_ENTITY = new Map(SYNC_ENTITIES.map((e) => [e.name, e]));

/** The order a table is applied in (parents first). */
export const ENTITY_ORDER = new Map(SYNC_ENTITIES.map((e, i) => [e.name, i]));

/** The gym of a row of this table, as SQL over the row alias (the same text on PostgreSQL and SQLite). */
export const orgSql = (e: SyncEntity, alias: string) => (e.parent ? `(SELECT "orgId" FROM "${e.parent[0]}" WHERE "id" = ${alias}."${e.parent[1]}")` : `${alias}."orgId"`);
