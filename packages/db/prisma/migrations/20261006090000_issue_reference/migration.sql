-- AlterTable
ALTER TABLE "Issue" ADD COLUMN     "reference" SERIAL NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Issue_reference_key" ON "Issue"("reference");
