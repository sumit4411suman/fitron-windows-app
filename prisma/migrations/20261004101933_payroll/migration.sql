-- AlterTable
ALTER TABLE "User" ADD COLUMN     "joinedOn" DATE,
ADD COLUMN     "payAccount" TEXT,
ADD COLUMN     "salary" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "SalaryPayment" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "month" TEXT,
    "date" DATE NOT NULL,
    "base" INTEGER NOT NULL DEFAULT 0,
    "days" INTEGER NOT NULL DEFAULT 0,
    "commission" INTEGER NOT NULL DEFAULT 0,
    "bonus" INTEGER NOT NULL DEFAULT 0,
    "deductions" INTEGER NOT NULL DEFAULT 0,
    "advance" INTEGER NOT NULL DEFAULT 0,
    "net" INTEGER NOT NULL,
    "recovered" INTEGER NOT NULL DEFAULT 0,
    "settledMonth" TEXT,
    "method" TEXT NOT NULL,
    "reference" TEXT,
    "note" TEXT,
    "expenseId" TEXT,
    "paidById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalaryPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SalaryPayment_expenseId_key" ON "SalaryPayment"("expenseId");

-- CreateIndex
CREATE INDEX "SalaryPayment_orgId_kind_month_idx" ON "SalaryPayment"("orgId", "kind", "month");

-- CreateIndex
CREATE INDEX "SalaryPayment_userId_kind_settledMonth_idx" ON "SalaryPayment"("userId", "kind", "settledMonth");

-- CreateIndex
CREATE UNIQUE INDEX "SalaryPayment_userId_kind_month_key" ON "SalaryPayment"("userId", "kind", "month");

-- AddForeignKey
ALTER TABLE "SalaryPayment" ADD CONSTRAINT "SalaryPayment_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalaryPayment" ADD CONSTRAINT "SalaryPayment_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalaryPayment" ADD CONSTRAINT "SalaryPayment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalaryPayment" ADD CONSTRAINT "SalaryPayment_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalaryPayment" ADD CONSTRAINT "SalaryPayment_paidById_fkey" FOREIGN KEY ("paidById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

