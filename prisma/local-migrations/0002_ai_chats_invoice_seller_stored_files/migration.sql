-- FITRON Local Windows Edition: the SQLite twin of five Cloud migrations (prisma/migrations/20261008190000_ai_chat_history,
-- 20261009100000_invoice_seller_member_consent, 20261009120000_device_command_expiry, 20261010090000_imported_member_join_date
-- and 20261010091000_stored_files). Generated with `prisma migrate diff --from-schema <the previous schema.local.prisma>
-- --to-schema prisma/schema.local.prisma --script`, then the data step written by hand (marked "-- fitron:"). Additive only:
-- no table or column is dropped and no amount changes. Row-level security has no SQLite counterpart (DATABASE-MIGRATION.md).

-- AlterTable
ALTER TABLE "Member" ADD COLUMN "consentAt" DATETIME;

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN "seller" JSONB;

-- AlterTable
ALTER TABLE "DeviceCommand" ADD COLUMN "expiresAt" DATETIME;

-- CreateTable
CREATE TABLE "AiChat" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "AiChatMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "chatId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "attachments" JSONB,
    "proposals" JSONB,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiChatMessage_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "AiChat" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StoredFile" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "body" BLOB NOT NULL,
    "contentType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "AiChat_orgId_userId_updatedAt_idx" ON "AiChat"("orgId", "userId", "updatedAt");

-- CreateIndex
CREATE INDEX "AiChatMessage_chatId_createdAt_idx" ON "AiChatMessage"("chatId", "createdAt");


-- fitron: members brought in by the member import were dated the day of the import, so the dashboard counted every one of
-- them as a new member that day. Their join date becomes the start of their first migrated plan (the import does this itself
-- from now on). Only members with a migrated plan that started before they were added are touched; safe to run again.
-- Dates are compared as instants (julianday), not as text: Prisma writes ISO-8601 text, CURRENT_TIMESTAMP another form.
UPDATE "Member"
SET "createdAt" = (SELECT MIN(ms."startDate") FROM "Membership" ms WHERE ms."memberId" = "Member"."id" AND ms."type" = 'IMPORT')
WHERE EXISTS (
  SELECT 1 FROM "Membership" ms
  WHERE ms."memberId" = "Member"."id" AND ms."type" = 'IMPORT' AND julianday(ms."startDate") < julianday("Member"."createdAt")
);
