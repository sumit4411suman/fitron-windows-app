-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "branchId" TEXT,
ADD COLUMN     "hash" VARCHAR(64),
ADD COLUMN     "prevHash" VARCHAR(64);

-- CreateIndex
CREATE INDEX "AuditLog_orgId_id_idx" ON "AuditLog"("orgId", "id");

