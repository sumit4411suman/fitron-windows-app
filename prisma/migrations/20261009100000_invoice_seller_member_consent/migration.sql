-- An invoice keeps the seller details (gym name, address, GSTIN, tax) as they were when it was made, so a later change in
-- Settings never alters an old invoice. Members record when they agreed to the privacy notice; consent is no longer assumed.
-- Additive only.

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN "seller" JSONB;

-- AlterTable
ALTER TABLE "Member" ADD COLUMN "consentAt" TIMESTAMPTZ;
