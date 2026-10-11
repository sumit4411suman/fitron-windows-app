-- FITRON Local Windows Edition: initial SQLite schema.
-- Generated from prisma/schema.local.prisma with `prisma migrate diff --from-empty --to-schema prisma/schema.local.prisma --script`,
-- then adjusted by hand where SQLite differs from the generated text (marked "-- fitron:"). Applied by
-- src/lib/runtime/local-migrate.ts inside one transaction. Never edit an applied migration: add a new folder.

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "demo" BOOLEAN NOT NULL DEFAULT false,
    "plan" TEXT NOT NULL DEFAULT 'professional',
    "planCycle" TEXT NOT NULL DEFAULT 'MONTHLY',
    "trialEndsAt" DATETIME,
    "trainerCode" TEXT
);

-- CreateTable
CREATE TABLE "Branch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "gstin" TEXT,
    "short" TEXT,
    "hours" TEXT,
    "manager" TEXT,
    "invoicePrefix" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "deactivatedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Branch_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "ptRate" INTEGER NOT NULL DEFAULT 0,
    "shift" TEXT,
    "photoKey" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" DATETIME,
    "emailVerifiedAt" DATETIME,
    "totpSecret" BLOB,
    "totpEnabledAt" DATETIME,
    "totpLastStep" INTEGER,
    "salary" INTEGER NOT NULL DEFAULT 0,
    "joinedOn" DATETIME,
    "payAccount" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME,
    CONSTRAINT "User_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "User_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RecoveryCode" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "usedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RecoveryCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuthToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "usedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuthToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuthCode" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" DATETIME NOT NULL,
    "usedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuthCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Permission" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "roleId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,

    PRIMARY KEY ("roleId", "permissionId"),
    CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "RolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "UserBranch" (
    "userId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,

    PRIMARY KEY ("userId", "branchId"),
    CONSTRAINT "UserBranch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "UserBranch_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Member" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "oldId" TEXT,
    "orgId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "gender" TEXT NOT NULL,
    "dob" DATETIME,
    "phone" TEXT NOT NULL,
    "whatsapp" TEXT,
    "email" TEXT,
    "occupation" TEXT,
    "house" TEXT,
    "area" TEXT,
    "city" TEXT,
    "state" TEXT,
    "pin" TEXT,
    "emergencyName" TEXT,
    "emergencyRelation" TEXT,
    "emergencyPhone" TEXT,
    "source" TEXT NOT NULL,
    "notes" TEXT,
    "staffNotes" TEXT,
    "tags" TEXT NOT NULL DEFAULT '[]',
    "photoKey" TEXT,
    "trainerId" TEXT,
    "workoutPlanId" TEXT,
    "dietPlanId" TEXT,
    "suspended" BOOLEAN NOT NULL DEFAULT false,
    "walkIn" BOOLEAN NOT NULL DEFAULT false,
    "riskScore" INTEGER,
    "riskReasons" TEXT NOT NULL DEFAULT '[]',
    "devicePin" TEXT,
    "cardNo" TEXT,
    "biometricConsentAt" DATETIME,
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME,
    "deletedById" TEXT,
    "deleteReason" TEXT,
    "erasedAt" DATETIME,
    CONSTRAINT "Member_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Member_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Member_workoutPlanId_fkey" FOREIGN KEY ("workoutPlanId") REFERENCES "WorkoutPlan" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Member_dietPlanId_fkey" FOREIGN KEY ("dietPlanId") REFERENCES "DietPlan" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MembershipPlan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "months" INTEGER NOT NULL,
    "price" INTEGER NOT NULL,
    "regFee" INTEGER NOT NULL,
    "discount" INTEGER NOT NULL DEFAULT 0,
    "gstApplicable" BOOLEAN NOT NULL DEFAULT true,
    "kind" TEXT NOT NULL,
    "description" TEXT,
    "features" TEXT NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MembershipPlan_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PlanPrice" (
    "planId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "price" INTEGER NOT NULL,

    PRIMARY KEY ("planId", "category"),
    CONSTRAINT "PlanPrice_planId_fkey" FOREIGN KEY ("planId") REFERENCES "MembershipPlan" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "startDate" DATETIME NOT NULL,
    "endDate" DATETIME NOT NULL,
    "price" INTEGER NOT NULL,
    "discount" INTEGER NOT NULL,
    "pricingCategory" TEXT NOT NULL,
    "offerCode" TEXT,
    "invoiceId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'VALID',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Membership_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Membership_planId_fkey" FOREIGN KEY ("planId") REFERENCES "MembershipPlan" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Membership_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Membership_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "number" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "dueDate" DATETIME NOT NULL,
    "subtotal" INTEGER NOT NULL,
    "discount" INTEGER NOT NULL,
    "tax" INTEGER NOT NULL,
    "total" INTEGER NOT NULL,
    "gstType" TEXT,
    "gstRate" DECIMAL,
    "status" TEXT NOT NULL,
    "cancelReason" TEXT,
    "cancelledById" TEXT,
    "cancelledAt" DATETIME,
    "pdfKey" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Invoice_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Invoice_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Invoice_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InvoiceItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "invoiceId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "rate" INTEGER NOT NULL,
    "discount" INTEGER NOT NULL,
    "taxRate" DECIMAL NOT NULL,
    "taxAmount" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "category" TEXT NOT NULL,
    "planId" TEXT,
    "productId" TEXT,
    "trainerId" TEXT,
    CONSTRAINT "InvoiceItem_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "amount" INTEGER NOT NULL,
    "method" TEXT NOT NULL,
    "txnRef" TEXT,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'SUCCESS',
    "receivedById" TEXT NOT NULL,
    "reversedById" TEXT,
    "reversedAt" DATETIME,
    "reverseReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Payment_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Payment_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Payment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Payment_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Expense" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "categoryId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "vendor" TEXT,
    "amount" INTEGER NOT NULL,
    "method" TEXT NOT NULL,
    "billNo" TEXT,
    "attachmentKey" TEXT,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "voidReason" TEXT,
    "capital" BOOLEAN NOT NULL DEFAULT false,
    "assetId" TEXT,
    "purchaseId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Expense_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Expense_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Expense_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ExpenseCategory" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Expense_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SalaryPayment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "month" TEXT,
    "date" DATETIME NOT NULL,
    "base" INTEGER NOT NULL DEFAULT 0,
    "days" INTEGER NOT NULL DEFAULT 0,
    "commission" INTEGER NOT NULL DEFAULT 0,
    "bonus" INTEGER NOT NULL DEFAULT 0,
    "deductions" INTEGER NOT NULL DEFAULT 0,
    "advance" INTEGER NOT NULL DEFAULT 0,
    "net" INTEGER NOT NULL,
    "recovered" INTEGER NOT NULL DEFAULT 0,
    "settledMonth" TEXT,
    "method" TEXT NOT NULL,
    "reference" TEXT,
    "note" TEXT,
    "expenseId" TEXT,
    "paidById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SalaryPayment_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SalaryPayment_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SalaryPayment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SalaryPayment_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "SalaryPayment_paidById_fkey" FOREIGN KEY ("paidById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ExpenseCategory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "group" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, -- fitron: rowid alias so SQLite assigns the number (BIGINT PRIMARY KEY would not)
    "orgId" TEXT NOT NULL,
    "userId" TEXT,
    "actorType" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,
    "userAgent" TEXT,
    "branchId" TEXT,
    "hash" TEXT,
    "prevHash" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MonthLock" (
    "branchId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "lockedById" TEXT NOT NULL,
    "lockedAt" DATETIME NOT NULL,

    PRIMARY KEY ("branchId", "month"),
    CONSTRAINT "MonthLock_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Setting" (
    "orgId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,

    PRIMARY KEY ("orgId", "key"),
    CONSTRAINT "Setting_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Sequence" (
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "next" INTEGER NOT NULL,

    PRIMARY KEY ("orgId", "name"),
    CONSTRAINT "Sequence_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Attendance" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "branchId" TEXT NOT NULL,
    "memberId" TEXT,
    "guestName" TEXT,
    "guestPhone" TEXT,
    "type" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "checkIn" DATETIME NOT NULL,
    "checkOut" DATETIME,
    "method" TEXT NOT NULL,
    "deviceId" TEXT,
    "override" TEXT,
    "autoOut" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    CONSTRAINT "Attendance_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Attendance_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "interest" TEXT NOT NULL,
    "stage" TEXT NOT NULL DEFAULT 'New',
    "stageAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "followUpOn" DATETIME,
    "trialOn" DATETIME,
    "ownerId" TEXT NOT NULL,
    "notes" TEXT,
    "lostReason" TEXT,
    "memberId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Lead_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Lead_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Lead_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ClassSlot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "trainerId" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "startTime" TEXT NOT NULL,
    "durationMin" INTEGER NOT NULL,
    "capacity" INTEGER NOT NULL,
    "room" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ClassSlot_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ClassSlot_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Booking" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "classSlotId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "memberId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Booking_classSlotId_fkey" FOREIGN KEY ("classSlotId") REFERENCES "ClassSlot" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Booking_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "price" INTEGER NOT NULL,
    "cost" INTEGER NOT NULL,
    "stock" INTEGER,
    "reorderLevel" INTEGER,
    "gstApplicable" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Product_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Product_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "productId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "note" TEXT,
    "unitCost" INTEGER,
    "invoiceItemId" TEXT,
    "expenseId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StockMovement_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WorkoutPlan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "goal" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "weeks" INTEGER NOT NULL,
    "days" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WorkoutPlan_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DietPlan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kcal" INTEGER NOT NULL,
    "protein" INTEGER NOT NULL,
    "meals" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DietPlan_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProgressLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "memberId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "weightKg" DECIMAL,
    "bodyFat" DECIMAL,
    "waistCm" DECIMAL,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProgressLog_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MembershipFreeze" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "fromDate" DATETIME NOT NULL,
    "days" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "endedOn" DATETIME,
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "branchId" TEXT,
    "userId" TEXT,
    "type" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "link" TEXT,
    "readAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Notification_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WhatsAppTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "metaTemplateName" TEXT,
    "language" TEXT NOT NULL DEFAULT 'en',
    "autoSend" BOOLEAN NOT NULL DEFAULT true,
    "ruleWhen" TEXT NOT NULL DEFAULT 'manual',
    "ruleDays" INTEGER NOT NULL DEFAULT 0,
    "ruleTime" TEXT NOT NULL DEFAULT '07:00',
    "rulePlanId" TEXT,
    "ruleGender" TEXT,
    "ruleMinDue" INTEGER NOT NULL DEFAULT 0,
    "ruleMaxPerWeek" INTEGER NOT NULL DEFAULT 3,
    "ruleExcludeAutopay" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WhatsAppTemplate_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WhatsAppMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "memberId" TEXT,
    "templateKey" TEXT NOT NULL,
    "toNumber" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "attachment" TEXT,
    "provider" TEXT NOT NULL,
    "providerMessageId" TEXT,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "sentById" TEXT,
    "sentAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scheduledFor" DATETIME,
    "deliveredAt" DATETIME,
    "readAt" DATETIME,
    CONSTRAINT "WhatsAppMessage_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "WhatsAppMessage_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AutopayMandate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "months" INTEGER NOT NULL,
    "mode" TEXT NOT NULL,
    "subscriptionId" TEXT,
    "shortUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Pending',
    "nextDebitOn" DATETIME,
    "nextRetryOn" DATETIME,
    "retries" INTEGER NOT NULL DEFAULT 0,
    "lastResult" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "vpa" TEXT,
    CONSTRAINT "AutopayMandate_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AutopayMandate_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AutopayEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventId" TEXT NOT NULL,
    "mandateId" TEXT,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "result" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AutopayEvent_mandateId_fkey" FOREIGN KEY ("mandateId") REFERENCES "AutopayMandate" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "JobRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "result" JSONB,
    "error" TEXT
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "qty" INTEGER NOT NULL DEFAULT 1,
    "vendor" TEXT,
    "purchaseDate" DATETIME NOT NULL,
    "cost" INTEGER NOT NULL,
    "salvage" INTEGER NOT NULL DEFAULT 0,
    "method" TEXT NOT NULL,
    "rate" DECIMAL,
    "life" INTEGER,
    "serial" TEXT,
    "billNo" TEXT,
    "payMethod" TEXT,
    "expenseId" TEXT,
    "purchaseId" TEXT,
    "accDepCarried" INTEGER NOT NULL DEFAULT 0,
    "depFrom" TEXT,
    "status" TEXT NOT NULL DEFAULT 'IN_USE',
    "disposedOn" DATETIME,
    "disposedFor" INTEGER,
    "disposeMethod" TEXT,
    "disposeNote" TEXT,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" DATETIME,
    CONSTRAINT "Asset_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Asset_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Purchase" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "vendor" TEXT NOT NULL,
    "billNo" TEXT,
    "notes" TEXT,
    "total" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "cancelReason" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Purchase_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Purchase_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PurchaseLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "purchaseId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT,
    "productId" TEXT,
    "assetId" TEXT,
    "expenseId" TEXT,
    "qty" INTEGER NOT NULL,
    "rate" INTEGER NOT NULL,
    "gstPct" DECIMAL NOT NULL,
    "amount" INTEGER NOT NULL,
    CONSTRAINT "PurchaseLine_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "VendorPayment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "purchaseId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "amount" INTEGER NOT NULL,
    "method" TEXT NOT NULL,
    "reference" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VendorPayment_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AiProposal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "memberIds" TEXT NOT NULL DEFAULT '[]',
    "body" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "payload" JSONB,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "result" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "doneAt" DATETIME
);

-- CreateTable
CREATE TABLE "Device" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT,
    "branchId" TEXT,
    "serial" TEXT NOT NULL,
    "model" TEXT,
    "name" TEXT,
    "ip" TEXT,
    "approved" BOOLEAN NOT NULL DEFAULT false,
    "relaySeconds" INTEGER NOT NULL DEFAULT 5,
    "lastSeenAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "DeviceCommand" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "deviceId" TEXT NOT NULL,
    "cmdNo" INTEGER NOT NULL,
    "command" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "returnCode" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" DATETIME,
    "ackAt" DATETIME,
    CONSTRAINT "DeviceCommand_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DeviceUser" (
    "deviceId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "allowed" BOOLEAN NOT NULL,
    "updatedAt" DATETIME NOT NULL,

    PRIMARY KEY ("deviceId", "memberId"),
    CONSTRAINT "DeviceUser_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BiometricTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "memberId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "slot" INTEGER NOT NULL,
    "deviceId" TEXT,
    "data" BLOB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "AccessLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "deviceId" TEXT NOT NULL,
    "branchId" TEXT,
    "memberId" TEXT,
    "pin" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "reason" TEXT,
    "at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "BranchSubscription" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'BRANCH',
    "plan" TEXT,
    "branchId" TEXT,
    "cycle" TEXT NOT NULL,
    "base" INTEGER NOT NULL,
    "gst" INTEGER NOT NULL,
    "total" INTEGER NOT NULL,
    "periodStart" DATETIME,
    "periodEnd" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "mode" TEXT NOT NULL,
    "utr" TEXT,
    "submittedAt" DATETIME,
    "reviewedBy" TEXT,
    "reviewedAt" DATETIME,
    "rejectReason" TEXT,
    "razorpayOrderId" TEXT,
    "razorpayPaymentId" TEXT,
    "razorpaySubscriptionId" TEXT,
    "invoiceNo" TEXT,
    "couponCode" TEXT,
    "discount" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" DATETIME
);

-- CreateTable
CREATE TABLE "RazorpaySubscription" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "orgId" TEXT,
    "memberId" TEXT,
    "plan" TEXT,
    "branchId" TEXT,
    "cycle" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'created',
    "paidCount" INTEGER NOT NULL DEFAULT 0,
    "nextChargeAt" DATETIME,
    "cancelledAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "MemberDocument" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "replacedById" TEXT,
    "uploadedById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" DATETIME,
    "deletedById" TEXT,
    "deleteReason" TEXT
);

-- CreateTable
CREATE TABLE "Backup" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "format" INTEGER NOT NULL DEFAULT 1,
    "counts" JSONB NOT NULL,
    "tables" INTEGER NOT NULL,
    "rows" INTEGER NOT NULL,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "downloadedAt" DATETIME,
    "restoredAt" DATETIME,
    "restoredById" TEXT,
    CONSTRAINT "Backup_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Enquiry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "plan" TEXT,
    "cycle" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "business" TEXT,
    "city" TEXT,
    "message" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "handledAt" DATETIME
);

-- CreateTable
CREATE TABLE "Offer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "type" TEXT NOT NULL,
    "value" INTEGER NOT NULL,
    "validTill" DATETIME NOT NULL,
    "usageLimit" INTEGER,
    "uses" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Offer_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Coupon" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "percentOff" INTEGER NOT NULL,
    "payPaise" INTEGER,
    "appliesTo" TEXT NOT NULL DEFAULT 'ALL',
    "validTill" DATETIME,
    "usageLimit" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "CouponRedemption" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "couponId" TEXT NOT NULL,
    "orgId" TEXT,
    "memberId" TEXT,
    "paymentId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "listTotal" INTEGER NOT NULL,
    "discount" INTEGER NOT NULL,
    "paid" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usedAt" DATETIME,
    CONSTRAINT "CouponRedemption_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "Coupon" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TrainerMember" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "plan" TEXT NOT NULL DEFAULT 'ai-pro',
    "cycle" TEXT NOT NULL DEFAULT 'MONTHLY',
    "trialEndsAt" DATETIME,
    "paidUntil" DATETIME,
    "planCancelled" BOOLEAN NOT NULL DEFAULT false,
    "profile" JSONB NOT NULL DEFAULT '{}', -- fitron: quoted (the generator emits a bare {} which SQLite rejects)
    "onboardedAt" DATETIME,
    "consentedAt" DATETIME,
    "emailVerifiedAt" DATETIME,
    "signupVia" TEXT NOT NULL DEFAULT 'EMAIL',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "lastSeenAt" DATETIME,
    "deletedEmailHash" TEXT,
    "orgId" TEXT,
    "gymMemberId" TEXT,
    "gymLinkedAt" DATETIME,
    CONSTRAINT "TrainerMember_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "TrainerMember_gymMemberId_fkey" FOREIGN KEY ("gymMemberId") REFERENCES "Member" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TrainerLoginToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "usedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "TrainerSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "memberId" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TrainerSession_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "TrainerMember" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TrainerDay" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "memberId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "water" REAL NOT NULL DEFAULT 0,
    "habits" JSONB NOT NULL DEFAULT '{}', -- fitron: quoted (the generator emits a bare {} which SQLite rejects)
    "workoutDone" BOOLEAN NOT NULL DEFAULT false,
    "focus" TEXT,
    "weightKg" REAL,
    "sets" JSONB NOT NULL DEFAULT '[]', -- fitron: quoted
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TrainerDay_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "TrainerMember" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TrainerChat" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "memberId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "messages" JSONB NOT NULL DEFAULT '[]', -- fitron: quoted
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TrainerChat_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "TrainerMember" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TrainerReview" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "memberId" TEXT NOT NULL,
    "weekStart" DATETIME NOT NULL,
    "workouts" INTEGER NOT NULL,
    "planned" INTEGER NOT NULL,
    "consistency" INTEGER NOT NULL,
    "nutrition" INTEGER NOT NULL,
    "avgWater" REAL NOT NULL,
    "insight" TEXT NOT NULL,
    "focus" JSONB NOT NULL DEFAULT '[]', -- fitron: quoted
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TrainerReview_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "TrainerMember" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TrainerPayment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "memberId" TEXT NOT NULL,
    "plan" TEXT NOT NULL,
    "cycle" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "base" INTEGER NOT NULL,
    "gst" INTEGER NOT NULL,
    "total" INTEGER NOT NULL,
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "utr" TEXT,
    "submittedAt" DATETIME,
    "reviewedBy" TEXT,
    "reviewedAt" DATETIME,
    "rejectReason" TEXT,
    "periodStart" DATETIME,
    "periodEnd" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" DATETIME,
    "razorpaySubscriptionId" TEXT,
    "razorpayPaymentId" TEXT,
    "razorpayOrderId" TEXT,
    "couponCode" TEXT,
    "discount" INTEGER NOT NULL DEFAULT 0,
    "gstIncluded" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "TrainerPayment_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "TrainerMember" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TrainerPush" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "memberId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userAgent" TEXT,
    "sent" JSONB NOT NULL DEFAULT '{}', -- fitron: quoted (the generator emits a bare {} which SQLite rejects)
    "failures" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TrainerPush_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "TrainerMember" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TrainerContent" (
    "ex" TEXT NOT NULL PRIMARY KEY,
    "videoUrl" TEXT NOT NULL,
    "note" TEXT,
    "updatedBy" TEXT,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "TrainerCoachUsage" (
    "memberId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY ("memberId", "date")
);

-- CreateTable
CREATE TABLE "SupportTicket" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "branchId" TEXT,
    "topic" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Open',
    "appVersion" TEXT NOT NULL,
    "browser" TEXT NOT NULL,
    "ip" TEXT,
    "emailedAt" DATETIME,
    "resolvedAt" DATETIME,
    "resolvedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SupportTicket_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SupportTicketReply" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ticketId" TEXT NOT NULL,
    "by" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SupportTicketReply_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "SupportTicket" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PersonalRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "lift" TEXT NOT NULL,
    "weightKg" DECIMAL NOT NULL,
    "reps" INTEGER NOT NULL DEFAULT 1,
    "date" DATETIME NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PersonalRecord_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Organization_trainerCode_key" ON "Organization"("trainerCode");

-- CreateIndex
CREATE INDEX "Branch_orgId_idx" ON "Branch"("orgId");

-- CreateIndex
CREATE INDEX "Branch_orgId_active_idx" ON "Branch"("orgId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "RecoveryCode_userId_codeHash_key" ON "RecoveryCode"("userId", "codeHash");

-- CreateIndex
CREATE INDEX "AuthToken_userId_purpose_idx" ON "AuthToken"("userId", "purpose");

-- CreateIndex
CREATE INDEX "AuthCode_userId_purpose_idx" ON "AuthCode"("userId", "purpose");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Role_name_key" ON "Role"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_key_key" ON "Permission"("key");

-- CreateIndex
CREATE INDEX "Member_orgId_phone_idx" ON "Member"("orgId", "phone");

-- CreateIndex
CREATE INDEX "Member_branchId_idx" ON "Member"("branchId");

-- CreateIndex
CREATE INDEX "Member_name_idx" ON "Member"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Member_orgId_code_key" ON "Member"("orgId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Member_orgId_devicePin_key" ON "Member"("orgId", "devicePin");

-- CreateIndex
CREATE UNIQUE INDEX "Member_orgId_cardNo_key" ON "Member"("orgId", "cardNo");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_invoiceId_key" ON "Membership"("invoiceId");

-- CreateIndex
CREATE INDEX "Membership_memberId_idx" ON "Membership"("memberId");

-- CreateIndex
CREATE INDEX "Membership_endDate_idx" ON "Membership"("endDate");

-- CreateIndex
CREATE INDEX "Invoice_memberId_idx" ON "Invoice"("memberId");

-- CreateIndex
CREATE INDEX "Invoice_date_idx" ON "Invoice"("date");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_orgId_number_key" ON "Invoice"("orgId", "number");

-- CreateIndex
CREATE INDEX "Payment_invoiceId_idx" ON "Payment"("invoiceId");

-- CreateIndex
CREATE INDEX "Payment_date_idx" ON "Payment"("date");

-- CreateIndex
CREATE INDEX "Payment_txnRef_idx" ON "Payment"("txnRef");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_orgId_code_key" ON "Payment"("orgId", "code");

-- CreateIndex
CREATE INDEX "Expense_branchId_date_idx" ON "Expense"("branchId", "date");

-- CreateIndex
CREATE INDEX "Expense_purchaseId_idx" ON "Expense"("purchaseId");

-- CreateIndex
CREATE UNIQUE INDEX "SalaryPayment_expenseId_key" ON "SalaryPayment"("expenseId");

-- CreateIndex
CREATE INDEX "SalaryPayment_orgId_kind_month_idx" ON "SalaryPayment"("orgId", "kind", "month");

-- CreateIndex
CREATE INDEX "SalaryPayment_userId_kind_settledMonth_idx" ON "SalaryPayment"("userId", "kind", "settledMonth");

-- CreateIndex
CREATE UNIQUE INDEX "SalaryPayment_userId_kind_month_key" ON "SalaryPayment"("userId", "kind", "month");

-- CreateIndex
CREATE INDEX "AuditLog_orgId_createdAt_idx" ON "AuditLog"("orgId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_orgId_id_idx" ON "AuditLog"("orgId", "id");

-- CreateIndex
CREATE INDEX "AuditLog_entity_entityId_idx" ON "AuditLog"("entity", "entityId");

-- CreateIndex
CREATE INDEX "Attendance_branchId_date_idx" ON "Attendance"("branchId", "date");

-- CreateIndex
CREATE INDEX "Attendance_memberId_date_idx" ON "Attendance"("memberId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Lead_memberId_key" ON "Lead"("memberId");

-- CreateIndex
CREATE INDEX "Lead_branchId_stage_idx" ON "Lead"("branchId", "stage");

-- CreateIndex
CREATE INDEX "Lead_followUpOn_idx" ON "Lead"("followUpOn");

-- CreateIndex
CREATE INDEX "ClassSlot_branchId_weekday_idx" ON "ClassSlot"("branchId", "weekday");

-- CreateIndex
CREATE INDEX "Booking_classSlotId_date_idx" ON "Booking"("classSlotId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Booking_classSlotId_date_memberId_key" ON "Booking"("classSlotId", "date", "memberId");

-- CreateIndex
CREATE UNIQUE INDEX "Product_branchId_sku_key" ON "Product"("branchId", "sku");

-- CreateIndex
CREATE INDEX "StockMovement_productId_createdAt_idx" ON "StockMovement"("productId", "createdAt");

-- CreateIndex
CREATE INDEX "ProgressLog_memberId_date_idx" ON "ProgressLog"("memberId", "date");

-- CreateIndex
CREATE INDEX "MembershipFreeze_memberId_idx" ON "MembershipFreeze"("memberId");

-- CreateIndex
CREATE INDEX "Notification_orgId_createdAt_idx" ON "Notification"("orgId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppTemplate_orgId_key_key" ON "WhatsAppTemplate"("orgId", "key");

-- CreateIndex
CREATE INDEX "WhatsAppMessage_memberId_templateKey_sentAt_idx" ON "WhatsAppMessage"("memberId", "templateKey", "sentAt");

-- CreateIndex
CREATE INDEX "WhatsAppMessage_orgId_sentAt_idx" ON "WhatsAppMessage"("orgId", "sentAt");

-- CreateIndex
CREATE INDEX "WhatsAppMessage_orgId_status_scheduledFor_idx" ON "WhatsAppMessage"("orgId", "status", "scheduledFor");

-- CreateIndex
CREATE INDEX "WhatsAppMessage_providerMessageId_idx" ON "WhatsAppMessage"("providerMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "AutopayMandate_subscriptionId_key" ON "AutopayMandate"("subscriptionId");

-- CreateIndex
CREATE INDEX "AutopayMandate_status_nextDebitOn_idx" ON "AutopayMandate"("status", "nextDebitOn");

-- CreateIndex
CREATE UNIQUE INDEX "AutopayMandate_orgId_code_key" ON "AutopayMandate"("orgId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "AutopayEvent_eventId_key" ON "AutopayEvent"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "JobRun_orgId_name_day_key" ON "JobRun"("orgId", "name", "day");

-- CreateIndex
CREATE INDEX "Asset_branchId_idx" ON "Asset"("branchId");

-- CreateIndex
CREATE UNIQUE INDEX "Asset_orgId_code_key" ON "Asset"("orgId", "code");

-- CreateIndex
CREATE INDEX "Purchase_branchId_date_idx" ON "Purchase"("branchId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Purchase_orgId_code_key" ON "Purchase"("orgId", "code");

-- CreateIndex
CREATE INDEX "VendorPayment_purchaseId_idx" ON "VendorPayment"("purchaseId");

-- CreateIndex
CREATE INDEX "AiProposal_orgId_userId_createdAt_idx" ON "AiProposal"("orgId", "userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Device_serial_key" ON "Device"("serial");

-- CreateIndex
CREATE INDEX "DeviceCommand_deviceId_status_idx" ON "DeviceCommand"("deviceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceCommand_deviceId_cmdNo_key" ON "DeviceCommand"("deviceId", "cmdNo");

-- CreateIndex
CREATE UNIQUE INDEX "BiometricTemplate_memberId_type_slot_key" ON "BiometricTemplate"("memberId", "type", "slot");

-- CreateIndex
CREATE INDEX "AccessLog_deviceId_at_idx" ON "AccessLog"("deviceId", "at");

-- CreateIndex
CREATE INDEX "AccessLog_memberId_at_idx" ON "AccessLog"("memberId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "BranchSubscription_utr_key" ON "BranchSubscription"("utr");

-- CreateIndex
CREATE UNIQUE INDEX "BranchSubscription_razorpayOrderId_key" ON "BranchSubscription"("razorpayOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "BranchSubscription_razorpayPaymentId_key" ON "BranchSubscription"("razorpayPaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "BranchSubscription_invoiceNo_key" ON "BranchSubscription"("invoiceNo");

-- CreateIndex
CREATE INDEX "BranchSubscription_orgId_status_idx" ON "BranchSubscription"("orgId", "status");

-- CreateIndex
CREATE INDEX "BranchSubscription_status_idx" ON "BranchSubscription"("status");

-- CreateIndex
CREATE INDEX "BranchSubscription_branchId_idx" ON "BranchSubscription"("branchId");

-- CreateIndex
CREATE INDEX "BranchSubscription_razorpaySubscriptionId_idx" ON "BranchSubscription"("razorpaySubscriptionId");

-- CreateIndex
CREATE INDEX "RazorpaySubscription_orgId_kind_status_idx" ON "RazorpaySubscription"("orgId", "kind", "status");

-- CreateIndex
CREATE INDEX "RazorpaySubscription_memberId_status_idx" ON "RazorpaySubscription"("memberId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "MemberDocument_storageKey_key" ON "MemberDocument"("storageKey");

-- CreateIndex
CREATE INDEX "MemberDocument_memberId_status_idx" ON "MemberDocument"("memberId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Backup_storageKey_key" ON "Backup"("storageKey");

-- CreateIndex
CREATE INDEX "Backup_orgId_createdAt_idx" ON "Backup"("orgId", "createdAt");

-- CreateIndex
CREATE INDEX "Enquiry_createdAt_idx" ON "Enquiry"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Offer_orgId_code_key" ON "Offer"("orgId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Coupon_code_key" ON "Coupon"("code");

-- CreateIndex
CREATE UNIQUE INDEX "CouponRedemption_paymentId_key" ON "CouponRedemption"("paymentId");

-- CreateIndex
CREATE INDEX "CouponRedemption_couponId_status_idx" ON "CouponRedemption"("couponId", "status");

-- CreateIndex
CREATE INDEX "CouponRedemption_orgId_idx" ON "CouponRedemption"("orgId");

-- CreateIndex
CREATE INDEX "CouponRedemption_memberId_idx" ON "CouponRedemption"("memberId");

-- CreateIndex
CREATE UNIQUE INDEX "TrainerMember_email_key" ON "TrainerMember"("email");

-- CreateIndex
CREATE UNIQUE INDEX "TrainerMember_gymMemberId_key" ON "TrainerMember"("gymMemberId");

-- CreateIndex
CREATE INDEX "TrainerMember_deletedEmailHash_idx" ON "TrainerMember"("deletedEmailHash");

-- CreateIndex
CREATE INDEX "TrainerMember_orgId_idx" ON "TrainerMember"("orgId");

-- CreateIndex
CREATE INDEX "TrainerLoginToken_email_createdAt_idx" ON "TrainerLoginToken"("email", "createdAt");

-- CreateIndex
CREATE INDEX "TrainerSession_memberId_idx" ON "TrainerSession"("memberId");

-- CreateIndex
CREATE UNIQUE INDEX "TrainerDay_memberId_date_key" ON "TrainerDay"("memberId", "date");

-- CreateIndex
CREATE INDEX "TrainerChat_memberId_updatedAt_idx" ON "TrainerChat"("memberId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "TrainerChat_memberId_clientId_key" ON "TrainerChat"("memberId", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "TrainerReview_memberId_weekStart_key" ON "TrainerReview"("memberId", "weekStart");

-- CreateIndex
CREATE UNIQUE INDEX "TrainerPayment_utr_key" ON "TrainerPayment"("utr");

-- CreateIndex
CREATE UNIQUE INDEX "TrainerPayment_razorpayPaymentId_key" ON "TrainerPayment"("razorpayPaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "TrainerPayment_razorpayOrderId_key" ON "TrainerPayment"("razorpayOrderId");

-- CreateIndex
CREATE INDEX "TrainerPayment_status_submittedAt_idx" ON "TrainerPayment"("status", "submittedAt");

-- CreateIndex
CREATE INDEX "TrainerPayment_memberId_createdAt_idx" ON "TrainerPayment"("memberId", "createdAt");

-- CreateIndex
CREATE INDEX "TrainerPayment_razorpaySubscriptionId_idx" ON "TrainerPayment"("razorpaySubscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "TrainerPush_endpoint_key" ON "TrainerPush"("endpoint");

-- CreateIndex
CREATE INDEX "TrainerPush_memberId_idx" ON "TrainerPush"("memberId");

-- CreateIndex
CREATE INDEX "SupportTicket_orgId_createdAt_idx" ON "SupportTicket"("orgId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SupportTicket_orgId_number_key" ON "SupportTicket"("orgId", "number");

-- CreateIndex
CREATE INDEX "SupportTicketReply_ticketId_createdAt_idx" ON "SupportTicketReply"("ticketId", "createdAt");

-- CreateIndex
CREATE INDEX "PersonalRecord_memberId_lift_idx" ON "PersonalRecord"("memberId", "lift");


-- fitron: phone is unique among live members (prisma/migrations/20260927200712_stage4_front_desk in the Cloud schema).
CREATE UNIQUE INDEX "Member_orgId_phone_active_key" ON "Member"("orgId", "phone") WHERE "deletedAt" IS NULL AND NOT "walkIn";

-- fitron: financial records are kept (the SQLite twin of prisma/migrations/20261005031500_financial_row_guard).
-- A DELETE of an invoice, payment, expense and the like is refused by the database itself, whoever asks, unless the
-- transaction first wrote its reason into _fitron_guard (src/lib/services/db-guard.ts): 'restore' (Settings > Backup >
-- Restore, after a safety copy) or 'demo-clear' (Go live > Clear demo data, only for rows of a gym flagged demo).
-- The row is removed again at the end of the transaction by the same code; a rolled-back transaction removes it too.
-- The audit log can be neither changed nor deleted. SQLite has no TRUNCATE, so no truncate trigger is needed.
-- fitron: COALESCE everywhere below. With no guard row the subquery is NULL, and NOT (NULL OR NULL) is NULL, which a
-- WHEN clause treats as false: the delete would go through. Every comparison is made NULL-free so "no permission" refuses.
CREATE TABLE "_fitron_guard" ("id" INTEGER NOT NULL PRIMARY KEY CHECK ("id" = 1), "allowDelete" TEXT NOT NULL);

CREATE TRIGGER "fitron_guard_delete_Invoice" BEFORE DELETE ON "Invoice" FOR EACH ROW
WHEN NOT (
  COALESCE((SELECT "allowDelete" FROM "_fitron_guard" WHERE "id" = 1), '') = 'restore'
  OR (COALESCE((SELECT "allowDelete" FROM "_fitron_guard" WHERE "id" = 1), '') = 'demo-clear' AND COALESCE((SELECT "demo" FROM "Organization" WHERE "id" = OLD."orgId"), 0) = 1)
) BEGIN SELECT RAISE(ABORT, 'Deleting a Invoice record is not allowed: financial records are kept. Void or reverse it in the app instead.'); END;

CREATE TRIGGER "fitron_guard_delete_InvoiceItem" BEFORE DELETE ON "InvoiceItem" FOR EACH ROW
WHEN NOT (
  COALESCE((SELECT "allowDelete" FROM "_fitron_guard" WHERE "id" = 1), '') = 'restore'
  OR (COALESCE((SELECT "allowDelete" FROM "_fitron_guard" WHERE "id" = 1), '') = 'demo-clear' AND COALESCE((SELECT o."demo" FROM "Organization" o JOIN "Invoice" i ON i."orgId" = o."id" WHERE i."id" = OLD."invoiceId"), 0) = 1)
) BEGIN SELECT RAISE(ABORT, 'Deleting a InvoiceItem record is not allowed: financial records are kept.'); END;

CREATE TRIGGER "fitron_guard_delete_Payment" BEFORE DELETE ON "Payment" FOR EACH ROW
WHEN NOT (
  COALESCE((SELECT "allowDelete" FROM "_fitron_guard" WHERE "id" = 1), '') = 'restore'
  OR (COALESCE((SELECT "allowDelete" FROM "_fitron_guard" WHERE "id" = 1), '') = 'demo-clear' AND COALESCE((SELECT "demo" FROM "Organization" WHERE "id" = OLD."orgId"), 0) = 1)
) BEGIN SELECT RAISE(ABORT, 'Deleting a Payment record is not allowed: financial records are kept. Reverse it in the app instead.'); END;

CREATE TRIGGER "fitron_guard_delete_Membership" BEFORE DELETE ON "Membership" FOR EACH ROW
WHEN NOT (
  COALESCE((SELECT "allowDelete" FROM "_fitron_guard" WHERE "id" = 1), '') = 'restore'
  OR (COALESCE((SELECT "allowDelete" FROM "_fitron_guard" WHERE "id" = 1), '') = 'demo-clear' AND COALESCE((SELECT o."demo" FROM "Organization" o JOIN "Member" m ON m."orgId" = o."id" WHERE m."id" = OLD."memberId"), 0) = 1)
) BEGIN SELECT RAISE(ABORT, 'Deleting a Membership record is not allowed: financial records are kept.'); END;

CREATE TRIGGER "fitron_guard_delete_Expense" BEFORE DELETE ON "Expense" FOR EACH ROW
WHEN NOT (
  COALESCE((SELECT "allowDelete" FROM "_fitron_guard" WHERE "id" = 1), '') = 'restore'
  OR (COALESCE((SELECT "allowDelete" FROM "_fitron_guard" WHERE "id" = 1), '') = 'demo-clear' AND COALESCE((SELECT "demo" FROM "Organization" WHERE "id" = OLD."orgId"), 0) = 1)
) BEGIN SELECT RAISE(ABORT, 'Deleting a Expense record is not allowed: financial records are kept. Void it in the app instead.'); END;

CREATE TRIGGER "fitron_guard_delete_Purchase" BEFORE DELETE ON "Purchase" FOR EACH ROW
WHEN NOT (
  COALESCE((SELECT "allowDelete" FROM "_fitron_guard" WHERE "id" = 1), '') = 'restore'
  OR (COALESCE((SELECT "allowDelete" FROM "_fitron_guard" WHERE "id" = 1), '') = 'demo-clear' AND COALESCE((SELECT "demo" FROM "Organization" WHERE "id" = OLD."orgId"), 0) = 1)
) BEGIN SELECT RAISE(ABORT, 'Deleting a Purchase record is not allowed: financial records are kept.'); END;

CREATE TRIGGER "fitron_guard_delete_PurchaseLine" BEFORE DELETE ON "PurchaseLine" FOR EACH ROW
WHEN NOT (
  COALESCE((SELECT "allowDelete" FROM "_fitron_guard" WHERE "id" = 1), '') = 'restore'
  OR (COALESCE((SELECT "allowDelete" FROM "_fitron_guard" WHERE "id" = 1), '') = 'demo-clear' AND COALESCE((SELECT o."demo" FROM "Organization" o JOIN "Purchase" p ON p."orgId" = o."id" WHERE p."id" = OLD."purchaseId"), 0) = 1)
) BEGIN SELECT RAISE(ABORT, 'Deleting a PurchaseLine record is not allowed: financial records are kept.'); END;

CREATE TRIGGER "fitron_guard_delete_VendorPayment" BEFORE DELETE ON "VendorPayment" FOR EACH ROW
WHEN NOT (
  COALESCE((SELECT "allowDelete" FROM "_fitron_guard" WHERE "id" = 1), '') = 'restore'
  OR (COALESCE((SELECT "allowDelete" FROM "_fitron_guard" WHERE "id" = 1), '') = 'demo-clear' AND COALESCE((SELECT o."demo" FROM "Organization" o JOIN "Purchase" p ON p."orgId" = o."id" WHERE p."id" = OLD."purchaseId"), 0) = 1)
) BEGIN SELECT RAISE(ABORT, 'Deleting a VendorPayment record is not allowed: financial records are kept.'); END;

CREATE TRIGGER "fitron_guard_delete_Asset" BEFORE DELETE ON "Asset" FOR EACH ROW
WHEN NOT (
  COALESCE((SELECT "allowDelete" FROM "_fitron_guard" WHERE "id" = 1), '') = 'restore'
  OR (COALESCE((SELECT "allowDelete" FROM "_fitron_guard" WHERE "id" = 1), '') = 'demo-clear' AND COALESCE((SELECT "demo" FROM "Organization" WHERE "id" = OLD."orgId"), 0) = 1)
) BEGIN SELECT RAISE(ABORT, 'Deleting a Asset record is not allowed: financial records are kept.'); END;

CREATE TRIGGER "fitron_guard_delete_Sequence" BEFORE DELETE ON "Sequence" FOR EACH ROW
WHEN NOT (
  COALESCE((SELECT "allowDelete" FROM "_fitron_guard" WHERE "id" = 1), '') = 'restore'
  OR (COALESCE((SELECT "allowDelete" FROM "_fitron_guard" WHERE "id" = 1), '') = 'demo-clear' AND COALESCE((SELECT "demo" FROM "Organization" WHERE "id" = OLD."orgId"), 0) = 1)
) BEGIN SELECT RAISE(ABORT, 'Deleting a Sequence record is not allowed: invoice numbering is kept.'); END;

-- Never deleted by anything: staff pay, FITRON subscription payments, AI Trainer payments.
CREATE TRIGGER "fitron_never_delete_SalaryPayment" BEFORE DELETE ON "SalaryPayment" FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'Deleting a SalaryPayment record is not allowed: financial records are kept.'); END;
CREATE TRIGGER "fitron_never_delete_BranchSubscription" BEFORE DELETE ON "BranchSubscription" FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'Deleting a BranchSubscription record is not allowed: financial records are kept.'); END;
CREATE TRIGGER "fitron_never_delete_TrainerPayment" BEFORE DELETE ON "TrainerPayment" FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'Deleting a TrainerPayment record is not allowed: financial records are kept.'); END;

-- The audit log: add to it, never change it.
CREATE TRIGGER "fitron_audit_append_only_update" BEFORE UPDATE ON "AuditLog" FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'The audit log is append-only: a row cannot be changed or removed.'); END;
CREATE TRIGGER "fitron_audit_append_only_delete" BEFORE DELETE ON "AuditLog" FOR EACH ROW
BEGIN SELECT RAISE(ABORT, 'The audit log is append-only: a row cannot be changed or removed.'); END;

-- fitron: FITRON's own tax invoices to gyms are numbered from one counter across all gyms (PostgreSQL: the sequence
-- fitron_invoice_seq). Hosted billing only; kept so the same code runs on both databases.
CREATE TABLE "_fitron_invoice_seq" ("n" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT);
