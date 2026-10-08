-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "trainerCode" TEXT;

-- AlterTable
ALTER TABLE "TrainerMember" ADD COLUMN     "gymLinkedAt" TIMESTAMPTZ,
ADD COLUMN     "gymMemberId" TEXT,
ADD COLUMN     "orgId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Organization_trainerCode_key" ON "Organization"("trainerCode");

-- CreateIndex
CREATE UNIQUE INDEX "TrainerMember_gymMemberId_key" ON "TrainerMember"("gymMemberId");

-- CreateIndex
CREATE INDEX "TrainerMember_orgId_idx" ON "TrainerMember"("orgId");

-- AddForeignKey
ALTER TABLE "TrainerMember" ADD CONSTRAINT "TrainerMember_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainerMember" ADD CONSTRAINT "TrainerMember_gymMemberId_fkey" FOREIGN KEY ("gymMemberId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;

