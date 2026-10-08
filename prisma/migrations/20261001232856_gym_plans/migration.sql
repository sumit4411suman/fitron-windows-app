-- AlterTable
ALTER TABLE "BranchSubscription" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'BRANCH',
ADD COLUMN     "plan" TEXT;
