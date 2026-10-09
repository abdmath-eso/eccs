-- Photo integrity: what is known about each proof photo (the phone's own time and
-- how far it is from the server's, a fingerprint of the file and of the picture,
-- where the phone was) and the reasons, if any, that the photo is doubtful.
ALTER TABLE "Attachment"
  ADD COLUMN "phoneCapturedAt" TIMESTAMP(3),
  ADD COLUMN "captureGapSeconds" INTEGER,
  ADD COLUMN "source" TEXT,
  ADD COLUMN "contentHash" TEXT,
  ADD COLUMN "perceptualHash" TEXT,
  ADD COLUMN "latitude" DOUBLE PRECISION,
  ADD COLUMN "longitude" DOUBLE PRECISION,
  ADD COLUMN "locationAccuracy" DOUBLE PRECISION,
  ADD COLUMN "locationMocked" BOOLEAN,
  ADD COLUMN "distanceMetres" INTEGER,
  ADD COLUMN "integrityFlags" JSONB,
  ADD COLUMN "doubtful" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "integrityCheckedAt" TIMESTAMP(3);

CREATE INDEX "Attachment_outletId_contentHash_idx" ON "Attachment"("outletId", "contentHash");
CREATE INDEX "Attachment_outletId_doubtful_idx" ON "Attachment"("outletId", "doubtful");
