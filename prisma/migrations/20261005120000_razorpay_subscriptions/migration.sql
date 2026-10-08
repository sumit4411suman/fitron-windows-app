-- Razorpay Subscriptions: plans that renew themselves (gym plans, extra branches, AI Trainer) and one-time add-ons.
-- Additive only: new table, new nullable columns, and TrainerPayment.gstIncluded (false for every existing row, which added GST on top).

-- AlterTable
ALTER TABLE "BranchSubscription" ADD COLUMN     "razorpaySubscriptionId" TEXT;

-- AlterTable
ALTER TABLE "TrainerPayment" ADD COLUMN     "gstIncluded" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "razorpayPaymentId" TEXT,
ADD COLUMN     "razorpaySubscriptionId" TEXT;

-- CreateTable
CREATE TABLE "RazorpaySubscription" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "orgId" TEXT,
    "memberId" TEXT,
    "plan" TEXT,
    "branchId" TEXT,
    "cycle" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'created',
    "paidCount" INTEGER NOT NULL DEFAULT 0,
    "nextChargeAt" TIMESTAMPTZ,
    "cancelledAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "RazorpaySubscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RazorpaySubscription_orgId_kind_status_idx" ON "RazorpaySubscription"("orgId", "kind", "status");

-- CreateIndex
CREATE INDEX "RazorpaySubscription_memberId_status_idx" ON "RazorpaySubscription"("memberId", "status");

-- CreateIndex
CREATE INDEX "BranchSubscription_razorpaySubscriptionId_idx" ON "BranchSubscription"("razorpaySubscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "TrainerPayment_razorpayPaymentId_key" ON "TrainerPayment"("razorpayPaymentId");

-- CreateIndex
CREATE INDEX "TrainerPayment_razorpaySubscriptionId_idx" ON "TrainerPayment"("razorpaySubscriptionId");

