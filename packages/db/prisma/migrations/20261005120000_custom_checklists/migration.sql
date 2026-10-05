-- AlterTable
ALTER TABLE "ChecklistTemplate" ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "outletId" TEXT;

-- AddForeignKey
ALTER TABLE "ChecklistTemplate" ADD CONSTRAINT "ChecklistTemplate_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE SET NULL ON UPDATE CASCADE;
