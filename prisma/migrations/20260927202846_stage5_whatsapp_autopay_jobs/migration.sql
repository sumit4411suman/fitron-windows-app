-- CreateTable
CREATE TABLE "WhatsAppTemplate" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "metaTemplateName" TEXT,
    "language" TEXT NOT NULL DEFAULT 'en',
    "autoSend" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "WhatsAppTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppMessage" (
    "id" TEXT NOT NULL,
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
    "sentAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMPTZ,
    "readAt" TIMESTAMPTZ,

    CONSTRAINT "WhatsAppMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutopayMandate" (
    "id" TEXT NOT NULL,
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
    "nextDebitOn" DATE,
    "retries" INTEGER NOT NULL DEFAULT 0,
    "lastResult" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "AutopayMandate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutopayEvent" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "mandateId" TEXT,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "result" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutopayEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobRun" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "startedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMPTZ,
    "result" JSONB,
    "error" TEXT,

    CONSTRAINT "JobRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppTemplate_orgId_key_key" ON "WhatsAppTemplate"("orgId", "key");

-- CreateIndex
CREATE INDEX "WhatsAppMessage_memberId_templateKey_sentAt_idx" ON "WhatsAppMessage"("memberId", "templateKey", "sentAt");

-- CreateIndex
CREATE INDEX "WhatsAppMessage_orgId_sentAt_idx" ON "WhatsAppMessage"("orgId", "sentAt");

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

-- AddForeignKey
ALTER TABLE "WhatsAppTemplate" ADD CONSTRAINT "WhatsAppTemplate_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppMessage" ADD CONSTRAINT "WhatsAppMessage_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppMessage" ADD CONSTRAINT "WhatsAppMessage_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutopayMandate" ADD CONSTRAINT "AutopayMandate_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutopayMandate" ADD CONSTRAINT "AutopayMandate_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutopayEvent" ADD CONSTRAINT "AutopayEvent_mandateId_fkey" FOREIGN KEY ("mandateId") REFERENCES "AutopayMandate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
