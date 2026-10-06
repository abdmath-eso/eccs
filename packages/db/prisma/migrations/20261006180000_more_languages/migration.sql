-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "Language" ADD VALUE 'TA';
ALTER TYPE "Language" ADD VALUE 'KN';
ALTER TYPE "Language" ADD VALUE 'ML';
ALTER TYPE "Language" ADD VALUE 'MR';
ALTER TYPE "Language" ADD VALUE 'BN';
ALTER TYPE "Language" ADD VALUE 'GU';
ALTER TYPE "Language" ADD VALUE 'PA';
ALTER TYPE "Language" ADD VALUE 'OR';
ALTER TYPE "Language" ADD VALUE 'UR';

