-- Business Intelligence & Growth Suite (docs/BUSINESS-INTELLIGENCE.md): the SQLite twin of the Cloud migration
-- 20261019120000_business_intelligence. Eight new tables, nothing changed on existing ones; no data step.

-- CreateTable
CREATE TABLE "RecoveryCase" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "invoiceId" TEXT,
    "membershipId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "openingAmount" INTEGER NOT NULL,
    "recoveredAmount" INTEGER NOT NULL DEFAULT 0,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "nextAction" TEXT NOT NULL,
    "nextActionOn" DATETIME,
    "assignedToId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" DATETIME,
    "promisedOn" DATETIME,
    "promisedAmount" INTEGER,
    "openedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" DATETIME,
    "closedById" TEXT,
    "closeReason" TEXT,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RecoveryCase_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "RecoveryCase_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RecoveryAttempt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "caseId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "note" TEXT,
    "whatsAppMessageId" TEXT,
    "paymentId" TEXT,
    "promisedOn" DATETIME,
    "promisedAmount" INTEGER,
    "byId" TEXT,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RecoveryAttempt_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "RecoveryCase" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Scenario" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "branchId" TEXT,
    "name" TEXT NOT NULL,
    "note" TEXT,
    "baseline" JSONB NOT NULL,
    "inputs" JSONB NOT NULL,
    "results" JSONB NOT NULL,
    "calcVersion" INTEGER NOT NULL,
    "baselineFrom" TEXT NOT NULL,
    "baselineTo" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "archivedAt" DATETIME
);

-- CreateTable
CREATE TABLE "Decision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "branchId" TEXT,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "objective" TEXT NOT NULL,
    "constraints" TEXT,
    "criteria" JSONB NOT NULL,
    "baseline" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "selectedId" TEXT,
    "rationale" TEXT,
    "decidedById" TEXT,
    "decidedAt" DATETIME,
    "deferredUntil" DATETIME,
    "implementedOn" DATETIME,
    "reviewDays" INTEGER NOT NULL DEFAULT 90,
    "reviewedAt" DATETIME,
    "actual" JSONB,
    "lessons" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "DecisionOption" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "decisionId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "inputs" JSONB NOT NULL,
    "results" JSONB NOT NULL,
    "calcVersion" INTEGER NOT NULL,
    "scores" JSONB NOT NULL,
    "benefits" TEXT,
    "costs" TEXT,
    "risks" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DecisionOption_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "Decision" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DecisionRevision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "decisionId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "note" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "byId" TEXT NOT NULL,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DecisionRevision_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "Decision" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Recommendation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "branchId" TEXT,
    "key" TEXT NOT NULL,
    "rule" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "link" TEXT,
    "evidence" JSONB NOT NULL,
    "periodFrom" TEXT NOT NULL,
    "periodTo" TEXT NOT NULL,
    "impactPaise" INTEGER,
    "impactNote" TEXT,
    "effort" TEXT NOT NULL,
    "urgency" TEXT NOT NULL,
    "confidence" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "decidedById" TEXT,
    "decidedAt" DATETIME,
    "deferredUntil" DATETIME,
    "completedAt" DATETIME,
    "outcome" JSONB,
    "outcomeNote" TEXT,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "BenchmarkSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "cohort" JSONB NOT NULL,
    "metrics" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "RecoveryCase_invoiceId_key" ON "RecoveryCase"("invoiceId");

-- CreateIndex
CREATE INDEX "RecoveryCase_orgId_status_priority_idx" ON "RecoveryCase"("orgId", "status", "priority");

-- CreateIndex
CREATE INDEX "RecoveryCase_orgId_memberId_idx" ON "RecoveryCase"("orgId", "memberId");

-- CreateIndex
CREATE INDEX "RecoveryCase_orgId_branchId_status_idx" ON "RecoveryCase"("orgId", "branchId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "RecoveryCase_orgId_kind_membershipId_key" ON "RecoveryCase"("orgId", "kind", "membershipId");

-- CreateIndex
CREATE UNIQUE INDEX "RecoveryAttempt_paymentId_key" ON "RecoveryAttempt"("paymentId");

-- CreateIndex
CREATE INDEX "RecoveryAttempt_caseId_at_idx" ON "RecoveryAttempt"("caseId", "at");

-- CreateIndex
CREATE INDEX "RecoveryAttempt_orgId_at_idx" ON "RecoveryAttempt"("orgId", "at");

-- CreateIndex
CREATE INDEX "Scenario_orgId_archivedAt_updatedAt_idx" ON "Scenario"("orgId", "archivedAt", "updatedAt");

-- CreateIndex
CREATE INDEX "Decision_orgId_status_updatedAt_idx" ON "Decision"("orgId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "DecisionOption_decisionId_idx" ON "DecisionOption"("decisionId");

-- CreateIndex
CREATE UNIQUE INDEX "DecisionRevision_decisionId_version_key" ON "DecisionRevision"("decisionId", "version");

-- CreateIndex
CREATE INDEX "Recommendation_orgId_status_score_idx" ON "Recommendation"("orgId", "status", "score");

-- CreateIndex
CREATE UNIQUE INDEX "Recommendation_orgId_key_key" ON "Recommendation"("orgId", "key");

-- CreateIndex
CREATE INDEX "BenchmarkSnapshot_month_idx" ON "BenchmarkSnapshot"("month");

-- CreateIndex
CREATE UNIQUE INDEX "BenchmarkSnapshot_orgId_month_key" ON "BenchmarkSnapshot"("orgId", "month");

