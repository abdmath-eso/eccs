-- AlterEnum
ALTER TYPE "AttachmentKind" ADD VALUE 'PROFILE';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "photoId" TEXT;

