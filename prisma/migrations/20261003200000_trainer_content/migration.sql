-- CreateTable
CREATE TABLE "TrainerContent" (
    "ex" TEXT NOT NULL,
    "videoUrl" TEXT NOT NULL,
    "note" TEXT,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "TrainerContent_pkey" PRIMARY KEY ("ex")
);

