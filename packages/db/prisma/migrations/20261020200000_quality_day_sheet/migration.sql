-- Quality and the day's sheet (Stage I, step 3; 20 Oct 2026). Written from `prisma migrate diff`;
-- everything is added, nothing existing is changed or removed, so a running API built before it
-- is unaffected.
--
-- 1. FollowUp and FollowUpCall: Quality > Follow-ups, one record per cause, with its calls.
-- 2. PhotoReview: a judgement in Quality > Photos; Attachment.photoReviewId and
--    ChecklistRun.photoReviewId point back to it; ChecklistRun.integrityFlags holds "too fast".
-- 3. Incident, with Attachment.incidentId for its photos and files.
-- 4. DaySheetSend: each "Send the day's sheet", with the visits as they stood.
-- 5. Job.free (a free follow-up visit, never invoiced), Job.returnedCount and
--    Inspection.returnedCount ("approved first time"), Issue.reopenedAt and reopenCount, and
--    ServiceType.carryItems and carrySample ("What to carry" in Catalogue).
-- AlterTable
ALTER TABLE "Attachment" ADD COLUMN     "incidentId" TEXT,
ADD COLUMN     "photoReviewId" TEXT;

-- AlterTable
ALTER TABLE "ChecklistRun" ADD COLUMN     "integrityFlags" JSONB,
ADD COLUMN     "photoReviewId" TEXT;

-- AlterTable
ALTER TABLE "Inspection" ADD COLUMN     "returnedCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Issue" ADD COLUMN     "reopenCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "reopenedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "free" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "returnedCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ServiceType" ADD COLUMN     "carryItems" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "carrySample" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "FollowUp" (
    "id" TEXT NOT NULL,
    "outletId" TEXT NOT NULL,
    "cause" TEXT NOT NULL,
    "causeKey" TEXT NOT NULL,
    "jobId" TEXT,
    "issueId" TEXT,
    "inspectionId" TEXT,
    "facts" JSONB NOT NULL,
    "causedAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "visitId" TEXT,
    "closedAt" TIMESTAMP(3),
    "closedById" TEXT,
    "closeNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FollowUp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FollowUpCall" (
    "id" TEXT NOT NULL,
    "followUpId" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "calledById" TEXT NOT NULL,
    "loggedById" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FollowUpCall_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhotoReview" (
    "id" TEXT NOT NULL,
    "outletId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "runId" TEXT,
    "jobId" TEXT,
    "verdict" TEXT NOT NULL,
    "note" TEXT,
    "photoIds" TEXT[],
    "reasons" JSONB NOT NULL,
    "told" INTEGER NOT NULL DEFAULT 0,
    "reviewedById" TEXT NOT NULL,
    "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PhotoReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Incident" (
    "id" TEXT NOT NULL,
    "reference" SERIAL NOT NULL,
    "outletId" TEXT NOT NULL,
    "jobId" TEXT,
    "happenedOn" DATE NOT NULL,
    "whatHappened" TEXT NOT NULL,
    "whatWasDone" TEXT,
    "costPaise" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdById" TEXT NOT NULL,
    "closedById" TEXT,
    "closedAt" TIMESTAMP(3),
    "closeNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Incident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DaySheetSend" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "supervisorId" TEXT NOT NULL,
    "sentById" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL,
    "visitsKey" TEXT NOT NULL,
    "visitCount" INTEGER NOT NULL,

    CONSTRAINT "DaySheetSend_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FollowUp_causeKey_key" ON "FollowUp"("causeKey");

-- CreateIndex
CREATE UNIQUE INDEX "FollowUp_visitId_key" ON "FollowUp"("visitId");

-- CreateIndex
CREATE INDEX "FollowUp_status_idx" ON "FollowUp"("status");

-- CreateIndex
CREATE INDEX "FollowUp_outletId_idx" ON "FollowUp"("outletId");

-- CreateIndex
CREATE INDEX "FollowUpCall_followUpId_idx" ON "FollowUpCall"("followUpId");

-- CreateIndex
CREATE INDEX "PhotoReview_outletId_reviewedAt_idx" ON "PhotoReview"("outletId", "reviewedAt");

-- CreateIndex
CREATE INDEX "PhotoReview_reviewedAt_idx" ON "PhotoReview"("reviewedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Incident_reference_key" ON "Incident"("reference");

-- CreateIndex
CREATE INDEX "Incident_status_idx" ON "Incident"("status");

-- CreateIndex
CREATE INDEX "Incident_outletId_idx" ON "Incident"("outletId");

-- CreateIndex
CREATE INDEX "DaySheetSend_date_supervisorId_idx" ON "DaySheetSend"("date", "supervisorId");

-- CreateIndex
CREATE INDEX "Attachment_incidentId_idx" ON "Attachment"("incidentId");

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUpCall" ADD CONSTRAINT "FollowUpCall_followUpId_fkey" FOREIGN KEY ("followUpId") REFERENCES "FollowUp"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhotoReview" ADD CONSTRAINT "PhotoReview_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;
