-- The console plan's tabs and data (Stage I, step 1; 20 Oct 2026). Written from
-- `prisma migrate diff`; everything is added, nothing existing is changed or removed.
--
-- 1. Outlet.area: the part of the city an outlet is in, for the Visits week board.
-- 2. VisitSettings: one row of the week board's capacity per day. No row means the defaults.
-- 3. Quote: what came of a sent quote (won or declined, by whom, and why).
-- 4. OutletOnboarding and its entries: an outlet's first ten days (Clients, New outlets).
-- 5. JoiningDocument.expiresOn: when a team member's document runs out or must be renewed.

ALTER TABLE "Outlet" ADD COLUMN "area" TEXT;

CREATE TABLE "VisitSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "capacityMon" INTEGER NOT NULL DEFAULT 5,
    "capacityTue" INTEGER NOT NULL DEFAULT 5,
    "capacityWed" INTEGER NOT NULL DEFAULT 5,
    "capacityThu" INTEGER NOT NULL DEFAULT 5,
    "capacityFri" INTEGER NOT NULL DEFAULT 5,
    "capacitySat" INTEGER NOT NULL DEFAULT 4,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VisitSettings_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Quote" ADD COLUMN "outcome" TEXT,
ADD COLUMN "outcomeAt" TIMESTAMP(3),
ADD COLUMN "outcomeById" TEXT,
ADD COLUMN "outcomeReason" TEXT;

CREATE TABLE "OutletOnboarding" (
    "id" TEXT NOT NULL,
    "outletId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "startedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutletOnboarding_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OutletOnboardingEntry" (
    "id" TEXT NOT NULL,
    "onboardingId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "note" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "byId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutletOnboardingEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OutletOnboarding_outletId_key" ON "OutletOnboarding"("outletId");

CREATE INDEX "OutletOnboardingEntry_onboardingId_kind_idx" ON "OutletOnboardingEntry"("onboardingId", "kind");

-- Removed with their outlet, so deleting an outlet (the tests do) never waits on them.
ALTER TABLE "OutletOnboarding" ADD CONSTRAINT "OutletOnboarding_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OutletOnboardingEntry" ADD CONSTRAINT "OutletOnboardingEntry_onboardingId_fkey" FOREIGN KEY ("onboardingId") REFERENCES "OutletOnboarding"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "JoiningDocument" ADD COLUMN "expiresOn" DATE;
