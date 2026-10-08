-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "assetId" TEXT,
ADD COLUMN     "capital" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "purchaseId" TEXT;

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "qty" INTEGER NOT NULL DEFAULT 1,
    "vendor" TEXT,
    "purchaseDate" DATE NOT NULL,
    "cost" INTEGER NOT NULL,
    "salvage" INTEGER NOT NULL DEFAULT 0,
    "method" TEXT NOT NULL,
    "rate" DECIMAL(5,2),
    "life" INTEGER,
    "serial" TEXT,
    "billNo" TEXT,
    "payMethod" TEXT,
    "expenseId" TEXT,
    "purchaseId" TEXT,
    "accDepCarried" INTEGER NOT NULL DEFAULT 0,
    "depFrom" TEXT,
    "status" TEXT NOT NULL DEFAULT 'IN_USE',
    "disposedOn" DATE,
    "disposedFor" INTEGER,
    "disposeMethod" TEXT,
    "disposeNote" TEXT,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMPTZ,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Purchase" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "vendor" TEXT NOT NULL,
    "billNo" TEXT,
    "notes" TEXT,
    "total" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "cancelReason" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Purchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseLine" (
    "id" TEXT NOT NULL,
    "purchaseId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT,
    "productId" TEXT,
    "assetId" TEXT,
    "expenseId" TEXT,
    "qty" INTEGER NOT NULL,
    "rate" INTEGER NOT NULL,
    "gstPct" DECIMAL(5,2) NOT NULL,
    "amount" INTEGER NOT NULL,

    CONSTRAINT "PurchaseLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendorPayment" (
    "id" TEXT NOT NULL,
    "purchaseId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "amount" INTEGER NOT NULL,
    "method" TEXT NOT NULL,
    "reference" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VendorPayment_pkey" PRIMARY KEY ("id")
);

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
CREATE INDEX "Expense_purchaseId_idx" ON "Expense"("purchaseId");

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseLine" ADD CONSTRAINT "PurchaseLine_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorPayment" ADD CONSTRAINT "VendorPayment_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
