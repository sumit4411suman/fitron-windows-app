-- CreateTable
CREATE TABLE "Backup" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "format" INTEGER NOT NULL DEFAULT 1,
    "counts" JSONB NOT NULL,
    "tables" INTEGER NOT NULL,
    "rows" INTEGER NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "downloadedAt" TIMESTAMPTZ,
    "restoredAt" TIMESTAMPTZ,
    "restoredById" TEXT,

    CONSTRAINT "Backup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Backup_storageKey_key" ON "Backup"("storageKey");

-- CreateIndex
CREATE INDEX "Backup_orgId_createdAt_idx" ON "Backup"("orgId", "createdAt");

-- AddForeignKey
ALTER TABLE "Backup" ADD CONSTRAINT "Backup_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

