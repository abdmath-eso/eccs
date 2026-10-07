-- When ECCS sends a report back to the Supervisor, it says what to correct.
ALTER TABLE "Job" ADD COLUMN "reviewNote" TEXT;
