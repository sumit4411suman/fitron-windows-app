-- AlterTable
ALTER TABLE "Member" ADD COLUMN     "deleteReason" TEXT,
ADD COLUMN     "deletedById" TEXT;

-- CreateTable
CREATE TABLE "PersonalRecord" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "lift" TEXT NOT NULL,
    "weightKg" DECIMAL(5,1) NOT NULL,
    "reps" INTEGER NOT NULL DEFAULT 1,
    "date" DATE NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PersonalRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PersonalRecord_memberId_lift_idx" ON "PersonalRecord"("memberId", "lift");

-- AddForeignKey
ALTER TABLE "PersonalRecord" ADD CONSTRAINT "PersonalRecord_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

