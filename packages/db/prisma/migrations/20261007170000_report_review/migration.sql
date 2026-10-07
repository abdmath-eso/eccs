-- ECCS checks a finished visit's report before the restaurant sees it.
ALTER TABLE "Job" ADD COLUMN "reviewedAt" TIMESTAMP(3),
ADD COLUMN "reviewedById" TEXT;

-- Reports finished before this rule existed count as already checked.
UPDATE "Job" SET "reviewedAt" = COALESCE("completedAt", CURRENT_TIMESTAMP) WHERE "status" IN ('COMPLETED', 'APPROVED');
