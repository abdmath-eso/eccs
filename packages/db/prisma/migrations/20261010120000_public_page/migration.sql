-- The customer QR page (phase 1d).
-- The page is off until the restaurant's Owner turns it on. Until now nothing was
-- published at all, so rows made earlier (by the sample seed) are switched off too.
ALTER TABLE "PublicProfile" ALTER COLUMN "isEnabled" SET DEFAULT false;
UPDATE "PublicProfile" SET "isEnabled" = false;

ALTER TABLE "PublicProfile"
  ADD COLUMN "tokenChangedAt" TIMESTAMP(3),
  ADD COLUMN "takenDownAt" TIMESTAMP(3),
  ADD COLUMN "takenDownById" TEXT,
  ADD COLUMN "takenDownReason" TEXT;

ALTER TABLE "PublicPhoto"
  ADD COLUMN "captionCode" TEXT,
  ADD COLUMN "decidedAt" TIMESTAMP(3),
  ADD COLUMN "rejectReason" TEXT,
  ADD COLUMN "removedAt" TIMESTAMP(3),
  ADD COLUMN "removedById" TEXT;
