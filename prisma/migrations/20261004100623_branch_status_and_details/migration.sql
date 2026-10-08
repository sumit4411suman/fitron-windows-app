-- AlterTable
ALTER TABLE "Branch" ADD COLUMN     "active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "deactivatedAt" TIMESTAMPTZ,
ADD COLUMN     "hours" TEXT,
ADD COLUMN     "invoicePrefix" TEXT,
ADD COLUMN     "manager" TEXT,
ADD COLUMN     "short" TEXT;

-- CreateIndex
CREATE INDEX "Branch_orgId_active_idx" ON "Branch"("orgId", "active");

