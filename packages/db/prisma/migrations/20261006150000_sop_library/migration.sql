-- AlterTable
ALTER TABLE "SopTemplate" ADD COLUMN     "libraryItemId" TEXT;

-- CreateTable
CREATE TABLE "SopLibraryItem" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "role" TEXT,
    "area" TEXT,
    "frequency" TEXT,
    "purpose" TEXT NOT NULL,
    "steps" TEXT NOT NULL,
    "controls" TEXT,
    "searchText" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SopLibraryItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SopLibraryItem_code_key" ON "SopLibraryItem"("code");

-- CreateIndex
CREATE INDEX "SopLibraryItem_isActive_category_section_idx" ON "SopLibraryItem"("isActive", "category", "section");

-- AddForeignKey
ALTER TABLE "SopTemplate" ADD CONSTRAINT "SopTemplate_libraryItemId_fkey" FOREIGN KEY ("libraryItemId") REFERENCES "SopLibraryItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

