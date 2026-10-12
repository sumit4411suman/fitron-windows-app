-- CreateTable
CREATE TABLE "WindowsLicenceOrder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "installationId" TEXT NOT NULL,
    "claimHash" TEXT NOT NULL,
    "plan" TEXT NOT NULL,
    "cycle" TEXT NOT NULL,
    "base" INTEGER NOT NULL,
    "gst" INTEGER NOT NULL,
    "total" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "licensee" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "gstin" TEXT,
    "razorpayOrderId" TEXT,
    "razorpayPaymentId" TEXT,
    "invoiceNo" TEXT,
    "licenceId" TEXT,
    "licenceText" TEXT,
    "periodStart" DATETIME,
    "periodEnd" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" DATETIME
);

-- CreateIndex
CREATE UNIQUE INDEX "WindowsLicenceOrder_razorpayOrderId_key" ON "WindowsLicenceOrder"("razorpayOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "WindowsLicenceOrder_razorpayPaymentId_key" ON "WindowsLicenceOrder"("razorpayPaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "WindowsLicenceOrder_invoiceNo_key" ON "WindowsLicenceOrder"("invoiceNo");

-- CreateIndex
CREATE UNIQUE INDEX "WindowsLicenceOrder_licenceId_key" ON "WindowsLicenceOrder"("licenceId");

-- CreateIndex
CREATE INDEX "WindowsLicenceOrder_installationId_status_idx" ON "WindowsLicenceOrder"("installationId", "status");

