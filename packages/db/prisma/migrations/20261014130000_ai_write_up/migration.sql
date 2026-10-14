-- AI features, part 2 (14 Oct 2026). Written by hand.
--
-- 1. The summary for an inspection report (feature 5): the Supervisor writes it after
--    Finish, by hand or from an AI draft they check and edit, and ECCS approves it with
--    the report. "fixFirst" is "Fix these first": ids of the inspection's own findings,
--    in order. "summaryAiDrafted" is true when the saved text started from an AI draft,
--    so the report can say so.
-- 2. "AiDigest" (feature 4): the daily digest of the ECCS console's Monitoring board,
--    one per India day, kept so that later openings cost nothing.
-- Nothing existing is changed or removed.

ALTER TABLE "Inspection" ADD COLUMN "summary" TEXT;

ALTER TABLE "Inspection" ADD COLUMN "fixFirst" JSONB;

ALTER TABLE "Inspection" ADD COLUMN "summaryAiDrafted" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Inspection" ADD COLUMN "summaryUpdatedAt" TIMESTAMP(3);

CREATE TABLE "AiDigest" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "overview" TEXT NOT NULL,
    "points" JSONB NOT NULL,
    "aiRequestId" TEXT NOT NULL,
    "madeAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiDigest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AiDigest_date_key" ON "AiDigest"("date");
