-- CreateTable
CREATE TABLE "MembershipFreeze" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "fromDate" DATE NOT NULL,
    "days" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "endedOn" DATE,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MembershipFreeze_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MembershipFreeze_memberId_idx" ON "MembershipFreeze"("memberId");

