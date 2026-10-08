-- CreateTable
CREATE TABLE "TrainerMember" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "plan" TEXT NOT NULL DEFAULT 'ai-pro',
    "cycle" TEXT NOT NULL DEFAULT 'MONTHLY',
    "trialEndsAt" TIMESTAMPTZ,
    "paidUntil" DATE,
    "planCancelled" BOOLEAN NOT NULL DEFAULT false,
    "profile" JSONB NOT NULL DEFAULT '{}',
    "onboardedAt" TIMESTAMPTZ,
    "consentedAt" TIMESTAMPTZ,
    "emailVerifiedAt" TIMESTAMPTZ,
    "signupVia" TEXT NOT NULL DEFAULT 'EMAIL',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "lastSeenAt" TIMESTAMPTZ,

    CONSTRAINT "TrainerMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainerLoginToken" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "usedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrainerLoginToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainerSession" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "lastSeenAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrainerSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainerDay" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "water" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "habits" JSONB NOT NULL DEFAULT '{}',
    "workoutDone" BOOLEAN NOT NULL DEFAULT false,
    "focus" TEXT,
    "weightKg" DOUBLE PRECISION,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "TrainerDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainerChat" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "messages" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "TrainerChat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainerReview" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "weekStart" DATE NOT NULL,
    "workouts" INTEGER NOT NULL,
    "planned" INTEGER NOT NULL,
    "consistency" INTEGER NOT NULL,
    "nutrition" INTEGER NOT NULL,
    "avgWater" DOUBLE PRECISION NOT NULL,
    "insight" TEXT NOT NULL,
    "focus" JSONB NOT NULL DEFAULT '[]',
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "TrainerReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainerPayment" (
    "id" TEXT NOT NULL,
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
    "submittedAt" TIMESTAMPTZ,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMPTZ,
    "rejectReason" TEXT,
    "periodStart" DATE,
    "periodEnd" DATE,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMPTZ,

    CONSTRAINT "TrainerPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainerCoachUsage" (
    "memberId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "TrainerCoachUsage_pkey" PRIMARY KEY ("memberId","date")
);

-- CreateIndex
CREATE UNIQUE INDEX "TrainerMember_email_key" ON "TrainerMember"("email");

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
CREATE INDEX "TrainerPayment_status_submittedAt_idx" ON "TrainerPayment"("status", "submittedAt");

-- CreateIndex
CREATE INDEX "TrainerPayment_memberId_createdAt_idx" ON "TrainerPayment"("memberId", "createdAt");

-- AddForeignKey
ALTER TABLE "TrainerSession" ADD CONSTRAINT "TrainerSession_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "TrainerMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainerDay" ADD CONSTRAINT "TrainerDay_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "TrainerMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainerChat" ADD CONSTRAINT "TrainerChat_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "TrainerMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainerReview" ADD CONSTRAINT "TrainerReview_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "TrainerMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainerPayment" ADD CONSTRAINT "TrainerPayment_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "TrainerMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

