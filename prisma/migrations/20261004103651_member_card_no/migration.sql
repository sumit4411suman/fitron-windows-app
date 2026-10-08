-- AlterTable
ALTER TABLE "Member" ADD COLUMN     "cardNo" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Member_orgId_cardNo_key" ON "Member"("orgId", "cardNo");

