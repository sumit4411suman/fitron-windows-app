-- CreateTable
CREATE TABLE "Enquiry" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "plan" TEXT,
    "cycle" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "business" TEXT,
    "city" TEXT,
    "message" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "handledAt" TIMESTAMPTZ,

    CONSTRAINT "Enquiry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Enquiry_createdAt_idx" ON "Enquiry"("createdAt");
