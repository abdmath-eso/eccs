-- AlterTable
ALTER TABLE "Outlet" ADD COLUMN     "code" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "linkedDeviceId" TEXT;

-- AlterTable
ALTER TABLE "User" DROP COLUMN "pinFailedAttempts",
DROP COLUMN "pinHash",
DROP COLUMN "pinLockedUntil",
ADD COLUMN     "pinLookup" TEXT,
ADD COLUMN     "pinOrganizationId" TEXT,
ALTER COLUMN "phone" DROP NOT NULL;

-- CreateTable
CREATE TABLE "LinkedDevice" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "outletId" TEXT,
    "tokenHash" TEXT NOT NULL,
    "name" TEXT,
    "failedPinAttempts" INTEGER NOT NULL DEFAULT 0,
    "pinLockedUntil" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LinkedDevice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LinkedDevice_tokenHash_key" ON "LinkedDevice"("tokenHash");

-- CreateIndex
CREATE INDEX "LinkedDevice_organizationId_idx" ON "LinkedDevice"("organizationId");

-- CreateIndex
CREATE INDEX "LinkedDevice_outletId_idx" ON "LinkedDevice"("outletId");

-- CreateIndex
CREATE UNIQUE INDEX "Outlet_code_key" ON "Outlet"("code");

-- CreateIndex
CREATE UNIQUE INDEX "User_pinOrganizationId_pinLookup_key" ON "User"("pinOrganizationId", "pinLookup");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_linkedDeviceId_fkey" FOREIGN KEY ("linkedDeviceId") REFERENCES "LinkedDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LinkedDevice" ADD CONSTRAINT "LinkedDevice_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LinkedDevice" ADD CONSTRAINT "LinkedDevice_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

