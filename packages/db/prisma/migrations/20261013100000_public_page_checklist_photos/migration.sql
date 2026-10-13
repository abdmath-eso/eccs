-- The customer QR page, 13 Oct 2026.
-- A photo on the page can now also come from the restaurant's own daily checks, so each
-- photo records where it came from; and every photo drops off the page 90 days after
-- the day it was taken, so each records that day.

ALTER TABLE "PublicPhoto"
  ADD COLUMN "source" TEXT,
  ADD COLUMN "takenOn" DATE;

-- Photos proposed before today. Where each came from is read off the photo itself:
-- a visit's photo, an inspection's, or one the Supervisor took specially for the page.
-- The day taken is the day in India of the photo's own time (the stored times are UTC),
-- and never later than the day it was proposed.
UPDATE "PublicPhoto" AS p
SET
  "source" = CASE
    WHEN a."checklistResponseId" IS NOT NULL THEN 'DAILY_CHECK'
    WHEN a."jobId" IS NOT NULL THEN 'ECCS_VISIT'
    WHEN a."inspectionFindingId" IS NOT NULL THEN 'ECCS_INSPECTION'
    ELSE 'ECCS_FOR_PAGE'
  END,
  "takenOn" = LEAST(
    ((COALESCE(a."capturedAt", a."createdAt") AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata')::date,
    ((p."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata')::date
  )
FROM "Attachment" AS a
WHERE a."id" = p."attachmentId";

ALTER TABLE "PublicPhoto"
  ALTER COLUMN "source" SET NOT NULL,
  ALTER COLUMN "takenOn" SET NOT NULL;
