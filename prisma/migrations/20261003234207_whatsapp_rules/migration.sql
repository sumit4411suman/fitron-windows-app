-- AlterTable
ALTER TABLE "WhatsAppMessage" ADD COLUMN     "scheduledFor" TIMESTAMPTZ;

-- AlterTable
ALTER TABLE "WhatsAppTemplate" ADD COLUMN     "ruleDays" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "ruleExcludeAutopay" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "ruleGender" TEXT,
ADD COLUMN     "ruleMaxPerWeek" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "ruleMinDue" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "rulePlanId" TEXT,
ADD COLUMN     "ruleTime" TEXT NOT NULL DEFAULT '07:00',
ADD COLUMN     "ruleWhen" TEXT NOT NULL DEFAULT 'manual';

-- CreateIndex
CREATE INDEX "WhatsAppMessage_orgId_status_scheduledFor_idx" ON "WhatsAppMessage"("orgId", "status", "scheduledFor");


-- Backfill the automation rule of every existing template from the prototype's defaults.
UPDATE "WhatsAppTemplate" SET "ruleWhen" = 'event' WHERE "key" IN ('welcome', 'payment', 'invoice', 'renewal', 'mandate', 'class');
UPDATE "WhatsAppTemplate" SET "ruleWhen" = 'dues_age', "ruleDays" = 5 WHERE "key" = 'due';
UPDATE "WhatsAppTemplate" SET "ruleWhen" = 'before_expiry', "ruleDays" = 15, "ruleExcludeAutopay" = true WHERE "key" = 'exp15';
UPDATE "WhatsAppTemplate" SET "ruleWhen" = 'before_expiry', "ruleDays" = 7, "ruleExcludeAutopay" = true WHERE "key" = 'exp7';
UPDATE "WhatsAppTemplate" SET "ruleWhen" = 'before_expiry', "ruleDays" = 3, "ruleExcludeAutopay" = true WHERE "key" = 'exp3';
UPDATE "WhatsAppTemplate" SET "ruleWhen" = 'before_expiry', "ruleDays" = 1, "ruleExcludeAutopay" = true WHERE "key" = 'exp1';
UPDATE "WhatsAppTemplate" SET "ruleWhen" = 'after_expiry', "ruleDays" = 0 WHERE "key" = 'expired';
UPDATE "WhatsAppTemplate" SET "ruleWhen" = 'before_debit', "ruleDays" = 1 WHERE "key" = 'autopay';
UPDATE "WhatsAppTemplate" SET "ruleWhen" = 'no_visit', "ruleDays" = 14 WHERE "key" = 'winback';
UPDATE "WhatsAppTemplate" SET "ruleWhen" = 'birthday' WHERE "key" = 'birthday';
UPDATE "WhatsAppTemplate" SET "ruleWhen" = 'manual' WHERE "key" = 'campaign';
