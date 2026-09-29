-- AlterTable
ALTER TABLE "User" ADD COLUMN "embedToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_embedToken_key" ON "User"("embedToken");
