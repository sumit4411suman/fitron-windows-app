-- CreateTable
CREATE TABLE "MemberDocument" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "replacedById" TEXT,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMPTZ,
    "deletedById" TEXT,
    "deleteReason" TEXT,

    CONSTRAINT "MemberDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MemberDocument_storageKey_key" ON "MemberDocument"("storageKey");

-- CreateIndex
CREATE INDEX "MemberDocument_memberId_status_idx" ON "MemberDocument"("memberId", "status");

