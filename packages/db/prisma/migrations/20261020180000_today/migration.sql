-- Today, the console's home (Stage I, step 2; 20 Oct 2026). Written from `prisma migrate diff`;
-- everything is added, nothing existing is changed or removed, so a running API built before it
-- is unaffected.
--
-- 1. Job.signOffRemindedAt and signOffRemindedById: the last time the office pressed Remind on a
--    finished visit waiting for the restaurant's sign-off, and who. Remind is once a day per visit.
-- 2. DayClose: "Close the day", once per India day: who, when, and the lines still open then.

-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "signOffRemindedAt" TIMESTAMP(3),
ADD COLUMN     "signOffRemindedById" TEXT;

-- CreateTable
CREATE TABLE "DayClose" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "closedById" TEXT NOT NULL,
    "closedAt" TIMESTAMP(3) NOT NULL,
    "openLines" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DayClose_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DayClose_date_key" ON "DayClose"("date");
