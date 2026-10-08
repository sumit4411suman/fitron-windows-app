// Permission keys and the default roles, taken from the prototype's ROLES table.
// Roles and their permissions live in the database (seeded from here) so a gym
// can adjust them later; code only ever checks keys.

export const PERMISSIONS = {
  "members.view": "See members",
  "members.create": "Add members",
  "members.edit": "Edit members",
  "members.delete": "Delete members",
  "members.all": "See every member, not only assigned ones",
  "memberships.renew": "Sell and renew memberships",
  "invoices.view": "See invoices",
  "invoices.create": "Create invoices",
  "invoices.cancel": "Cancel invoices",
  "payments.collect": "Collect payments",
  "payments.reverse": "Reverse payments",
  "expenses.manage": "Record expenses",
  "expenses.void": "Void expenses",
  "accounting.view": "See accounting and reports",
  "months.lock": "Lock months",
  "months.unlock": "Unlock months",
  "plans.manage": "Manage plans and offers",
  "staff.manage": "Manage staff and roles",
  "payroll.manage": "Pay salaries and advances",
  "settings.manage": "Change settings",
  "audit.view": "See the audit log",
  "whatsapp.send": "Send WhatsApp messages",
  "documents.manage": "Upload member documents",
  "leads.manage": "Manage leads and trials",
  "attendance.manage": "Record attendance",
  "classes.manage": "Manage classes and bookings",
  "pos.sell": "Sell at the counter",
  "products.manage": "Manage products, prices and stock",
  "programs.manage": "Manage workouts and diets",
  "autopay.manage": "Manage UPI autopay",
  "assets.manage": "Manage fixed assets",
  "purchases.manage": "Record supplier bills and payments",
  "import.run": "Import data",
  "ai.use": "Use Fitron AI",
  "branches.all": "Work across all branches",
} as const;

export type Permission = keyof typeof PERMISSIONS;

const ALL = Object.keys(PERMISSIONS) as Permission[];

export const DEFAULT_ROLES: Record<string, Permission[]> = {
  "Super Admin": ALL,
  Admin: ALL.filter((p) => !["staff.manage", "settings.manage", "audit.view", "months.unlock", "import.run", "branches.all"].includes(p)),
  Accountant: [
    "invoices.view",
    "invoices.create",
    "invoices.cancel",
    "payments.collect",
    "payments.reverse",
    "expenses.manage",
    "expenses.void",
    "payroll.manage",
    "accounting.view",
    "months.lock",
    "autopay.manage",
    "pos.sell",
    "products.manage",
    "assets.manage",
    "purchases.manage",
    "ai.use",
    "branches.all",
  ],
  Receptionist: [
    "members.view",
    "members.create",
    "members.edit",
    "members.all",
    "memberships.renew",
    "invoices.view",
    "invoices.create",
    "payments.collect",
    "whatsapp.send",
    "documents.manage",
    "leads.manage",
    "attendance.manage",
    "classes.manage",
    "pos.sell",
    "ai.use",
  ],
  Trainer: ["members.view", "attendance.manage", "classes.manage", "programs.manage"],
};

export const can = (perms: ReadonlySet<string>, p: Permission) => perms.has(p);
