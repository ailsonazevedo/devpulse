-- AddForeignKey
ALTER TABLE "DailyContribution" ADD CONSTRAINT "DailyContribution_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
