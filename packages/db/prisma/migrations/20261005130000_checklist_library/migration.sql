-- AlterTable
ALTER TABLE "ChecklistItem" ADD COLUMN     "libraryItemId" TEXT;

-- CreateTable
CREATE TABLE "ChecklistLibraryItem" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "checklistName" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "area" TEXT,
    "frequency" TEXT,
    "role" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
    "text" JSONB NOT NULL,
    "searchText" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChecklistLibraryItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ChecklistLibraryItem_code_key" ON "ChecklistLibraryItem"("code");

-- CreateIndex
CREATE INDEX "ChecklistLibraryItem_isActive_idx" ON "ChecklistLibraryItem"("isActive");

-- AddForeignKey
ALTER TABLE "ChecklistItem" ADD CONSTRAINT "ChecklistItem_libraryItemId_fkey" FOREIGN KEY ("libraryItemId") REFERENCES "ChecklistLibraryItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
