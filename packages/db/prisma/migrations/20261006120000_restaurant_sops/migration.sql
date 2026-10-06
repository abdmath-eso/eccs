-- AlterTable
ALTER TABLE "SopTemplate" ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "outletId" TEXT;

-- CreateIndex
CREATE INDEX "SopTemplate_outletId_idx" ON "SopTemplate"("outletId");

-- AddForeignKey
ALTER TABLE "SopTemplate" ADD CONSTRAINT "SopTemplate_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

