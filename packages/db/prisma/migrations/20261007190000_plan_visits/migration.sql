-- A visit created from a recurring schedule remembers the date it was due on.
ALTER TABLE "Job" ADD COLUMN "plannedFor" DATE;

-- Visits that already belong to a schedule were created on their due date.
UPDATE "Job" SET "plannedFor" = "scheduledDate" WHERE "scheduleId" IS NOT NULL;

-- One visit per schedule per due date.
CREATE UNIQUE INDEX "Job_scheduleId_plannedFor_key" ON "Job"("scheduleId", "plannedFor");
