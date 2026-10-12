-- CreateTable
CREATE TABLE "WindowsLicenceOrder" (
    "id" TEXT NOT NULL,
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
    "periodStart" DATE,
    "periodEnd" DATE,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMPTZ,

    CONSTRAINT "WindowsLicenceOrder_pkey" PRIMARY KEY ("id")
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


-- Like every table: closed to a database API such as Supabase's (src/lib/services/rls.db.test.ts).
ALTER TABLE "WindowsLicenceOrder" ENABLE ROW LEVEL SECURITY;
