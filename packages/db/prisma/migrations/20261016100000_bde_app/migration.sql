-- The BDE (salesperson) on the phone, 16 Oct 2026 (Stage B2 of the founders' business
-- dashboards). Written by hand.
--
-- A new kind of file, LEAD: a lead's photo of the shop board, or a free check's photo of
-- something that needs fixing. Like a profile photo it belongs to no outlet.
-- A lead keeps the photo of its shop board ("photoId"); removing the photo only clears it.
-- A lead's step keeps the free-check scorecard filled in on the phone ("scorecard": every
-- point's answer and its photo). Nothing existing is changed.
--
-- Postgres lets a new value be added to an enum inside the migration's transaction as
-- long as nothing in the same transaction uses it, which nothing here does.

ALTER TYPE "AttachmentKind" ADD VALUE 'LEAD';

ALTER TABLE "Lead" ADD COLUMN "photoId" TEXT;
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_photoId_fkey" FOREIGN KEY ("photoId") REFERENCES "Attachment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "LeadActivity" ADD COLUMN "scorecard" JSONB;
