-- CreateTable
CREATE TABLE "BranchSubscription" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "branchId" TEXT,
    "cycle" TEXT NOT NULL,
    "base" INTEGER NOT NULL,
    "gst" INTEGER NOT NULL,
    "total" INTEGER NOT NULL,
    "periodStart" DATE,
    "periodEnd" DATE,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "mode" TEXT NOT NULL,
    "razorpayOrderId" TEXT,
    "razorpayPaymentId" TEXT,
    "invoiceNo" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMPTZ,

    CONSTRAINT "BranchSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BranchSubscription_razorpayOrderId_key" ON "BranchSubscription"("razorpayOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "BranchSubscription_razorpayPaymentId_key" ON "BranchSubscription"("razorpayPaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "BranchSubscription_invoiceNo_key" ON "BranchSubscription"("invoiceNo");

-- CreateIndex
CREATE INDEX "BranchSubscription_orgId_status_idx" ON "BranchSubscription"("orgId", "status");

-- CreateIndex
CREATE INDEX "BranchSubscription_branchId_idx" ON "BranchSubscription"("branchId");


-- Fitron tax invoice numbers run across all gyms.
CREATE SEQUENCE "fitron_invoice_seq" START 1;
