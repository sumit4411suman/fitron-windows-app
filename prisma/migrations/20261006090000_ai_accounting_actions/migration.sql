-- Fitron AI can draft accounting actions (invoice, payment, expense, membership sale, cancellation) for the user to confirm.
-- Additive only: one nullable column holding what to run on confirm.

-- AlterTable
ALTER TABLE "AiProposal" ADD COLUMN     "payload" JSONB;
