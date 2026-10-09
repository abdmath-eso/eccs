-- New services (9 Oct 2026). Written by hand, like the billing fields.
--
-- A kind of service gets the heading the app lists it under, and whether an
-- outside partner delivers part of it. A visit can record which partner.

ALTER TABLE "ServiceType" ADD COLUMN "category" TEXT NOT NULL DEFAULT 'CLEANING';
ALTER TABLE "ServiceType" ADD COLUMN "partnerDelivered" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Job" ADD COLUMN "partnerName" TEXT;

-- The four kinds that already exist: deep clean and chimney stay under CLEANING (the default).
UPDATE "ServiceType" SET "category" = 'PEST' WHERE "code" = 'PEST';
UPDATE "ServiceType" SET "category" = 'TESTING' WHERE "code" = 'SAFETY_INSPECTION';
