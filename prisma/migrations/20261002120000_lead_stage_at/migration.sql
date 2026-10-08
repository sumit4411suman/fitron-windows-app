-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "stageAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Existing leads: the last change is the best guess for when they reached their stage.
UPDATE "Lead" SET "stageAt" = "updatedAt";
