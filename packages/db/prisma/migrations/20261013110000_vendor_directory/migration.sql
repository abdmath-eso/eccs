-- The vendor directory, 13 Oct 2026. Written by hand.
--
-- One new table: the wholesalers and distributors that sell in bulk to
-- restaurants, shown to the Owner and Manager with the nearest to their outlet
-- first. A vendor belongs to no outlet: it is one list for every restaurant.
-- "categories" holds codes from VENDOR_CATEGORIES in packages/shared; "sells"
-- and "hours" hold text per language, like checklist names. Nothing existing
-- is changed.

CREATE TABLE "Vendor" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "categories" TEXT[],
    "sells" JSONB,
    "area" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "address" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "phone" TEXT,
    "whatsapp" TEXT,
    "delivers" BOOLEAN NOT NULL DEFAULT false,
    "minOrderPaise" INTEGER,
    "hours" JSONB,
    "fssaiNumber" TEXT,
    "isSample" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vendor_pkey" PRIMARY KEY ("id")
);

-- The loader finds a vendor again by its code.
CREATE UNIQUE INDEX "Vendor_code_key" ON "Vendor"("code");

CREATE INDEX "Vendor_city_idx" ON "Vendor"("city");
