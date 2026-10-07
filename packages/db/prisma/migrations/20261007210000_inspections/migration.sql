-- Scored inspections: "not applicable" as an answer, the non-compliance of each
-- answer (with its photos), the planned day, when it was started and finished,
-- the grade, and the note ECCS writes when sending a report back.

CREATE TYPE "InspectionAnswer" AS ENUM ('COMPLIANT', 'NON_COMPLIANT', 'NOT_APPLICABLE');

ALTER TABLE "Inspection" ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "grade" TEXT,
ADD COLUMN     "plannedDate" DATE,
ADD COLUMN     "reviewNote" TEXT,
ADD COLUMN     "startedAt" TIMESTAMP(3);

ALTER TABLE "InspectionFinding" ADD COLUMN     "responseId" TEXT,
ALTER COLUMN "severity" DROP NOT NULL;

-- Added empty first so that any answers already stored can be carried over, then made required.
ALTER TABLE "InspectionResponse" ADD COLUMN     "answer" "InspectionAnswer",
ADD COLUMN     "answeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "InspectionResponse" SET "answer" = CASE
  WHEN "passed" IS TRUE THEN 'COMPLIANT'::"InspectionAnswer"
  WHEN "passed" IS FALSE THEN 'NON_COMPLIANT'::"InspectionAnswer"
  ELSE 'NOT_APPLICABLE'::"InspectionAnswer"
END;

ALTER TABLE "InspectionResponse" ALTER COLUMN "answer" SET NOT NULL;

CREATE INDEX "Inspection_supervisorId_status_idx" ON "Inspection"("supervisorId", "status");

CREATE UNIQUE INDEX "InspectionFinding_responseId_key" ON "InspectionFinding"("responseId");

ALTER TABLE "InspectionFinding" ADD CONSTRAINT "InspectionFinding_responseId_fkey" FOREIGN KEY ("responseId") REFERENCES "InspectionResponse"("id") ON DELETE CASCADE ON UPDATE CASCADE;
