-- AlterTable
ALTER TABLE "BranchSubscription" ADD COLUMN     "couponCode" TEXT,
ADD COLUMN     "discount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "TrainerPayment" ADD COLUMN     "couponCode" TEXT,
ADD COLUMN     "discount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "razorpayOrderId" TEXT;

-- CreateTable
CREATE TABLE "Coupon" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "percentOff" INTEGER NOT NULL,
    "appliesTo" TEXT NOT NULL DEFAULT 'ALL',
    "validTill" DATE,
    "usageLimit" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "Coupon_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CouponRedemption" (
    "id" TEXT NOT NULL,
    "couponId" TEXT NOT NULL,
    "orgId" TEXT,
    "memberId" TEXT,
    "paymentId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "listTotal" INTEGER NOT NULL,
    "discount" INTEGER NOT NULL,
    "paid" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usedAt" TIMESTAMPTZ,

    CONSTRAINT "CouponRedemption_pkey" PRIMARY KEY ("id")
);

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
CREATE UNIQUE INDEX "TrainerPayment_razorpayOrderId_key" ON "TrainerPayment"("razorpayOrderId");

-- AddForeignKey
ALTER TABLE "CouponRedemption" ADD CONSTRAINT "CouponRedemption_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "Coupon"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Row-level security on the new tables (see 20261005180000_row_level_security).
ALTER TABLE "Coupon" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CouponRedemption" ENABLE ROW LEVEL SECURITY;
