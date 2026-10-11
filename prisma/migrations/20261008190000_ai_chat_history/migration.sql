-- Fitron AI keeps each person's conversations (history, reopen, delete). Files attached to a question are not stored:
-- a message keeps only their names. Additive only.

-- CreateTable
CREATE TABLE "AiChat" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "AiChat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiChatMessage" (
    "id" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "attachments" JSONB,
    "proposals" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiChat_orgId_userId_updatedAt_idx" ON "AiChat"("orgId", "userId", "updatedAt");

-- CreateIndex
CREATE INDEX "AiChatMessage_chatId_createdAt_idx" ON "AiChatMessage"("chatId", "createdAt");

-- AddForeignKey
ALTER TABLE "AiChatMessage" ADD CONSTRAINT "AiChatMessage_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "AiChat"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row-level security, as on every table (see 20261005180000_row_level_security).
ALTER TABLE "AiChat" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AiChatMessage" ENABLE ROW LEVEL SECURITY;
