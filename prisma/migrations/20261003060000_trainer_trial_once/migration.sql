-- AlterTable
ALTER TABLE "TrainerMember" ADD COLUMN     "deletedEmailHash" TEXT;

-- CreateIndex
CREATE INDEX "TrainerMember_deletedEmailHash_idx" ON "TrainerMember"("deletedEmailHash");

