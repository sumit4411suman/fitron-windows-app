-- CreateTable
CREATE TABLE "TrainerPush" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userAgent" TEXT,
    "sent" JSONB NOT NULL DEFAULT '{}',
    "failures" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrainerPush_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TrainerPush_endpoint_key" ON "TrainerPush"("endpoint");

-- CreateIndex
CREATE INDEX "TrainerPush_memberId_idx" ON "TrainerPush"("memberId");

-- AddForeignKey
ALTER TABLE "TrainerPush" ADD CONSTRAINT "TrainerPush_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "TrainerMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

