-- DropForeignKey
ALTER TABLE "TrainerPayment" DROP CONSTRAINT "TrainerPayment_memberId_fkey";

-- AddForeignKey
ALTER TABLE "TrainerPayment" ADD CONSTRAINT "TrainerPayment_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "TrainerMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

