-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "plan" TEXT NOT NULL DEFAULT 'professional',
ADD COLUMN     "planCycle" TEXT NOT NULL DEFAULT 'MONTHLY',
ADD COLUMN     "trialEndsAt" TIMESTAMPTZ;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "emailVerifiedAt" TIMESTAMPTZ;

-- CreateTable
CREATE TABLE "AuthToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "usedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuthToken_userId_purpose_idx" ON "AuthToken"("userId", "purpose");

-- AddForeignKey
ALTER TABLE "AuthToken" ADD CONSTRAINT "AuthToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- People who already had accounts were set up by hand, so their emails count as verified.
UPDATE "User" SET "emailVerifiedAt" = "createdAt";
