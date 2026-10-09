-- Staff, attendance and the salary tracker (phase 1d). Written by hand.
--
-- A staff member can be paid by the day as well as by the month, can have a
-- weekly day off, a leaving date and a link to their app login. A month's pay
-- record can carry the Owner's own figures in place of the ones the app works
-- out. Advances and payments are kept one by one, each with its date.

CREATE TYPE "StaffPayType" AS ENUM ('MONTHLY', 'DAILY');
CREATE TYPE "StaffPayEntryKind" AS ENUM ('ADVANCE', 'PAYMENT');

ALTER TABLE "StaffMember" ADD COLUMN "payType" "StaffPayType" NOT NULL DEFAULT 'MONTHLY';
ALTER TABLE "StaffMember" ALTER COLUMN "monthlySalaryPaise" SET DEFAULT 0;
ALTER TABLE "StaffMember" ADD COLUMN "dailyWagePaise" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "StaffMember" ADD COLUMN "weeklyOffDay" INTEGER;
ALTER TABLE "StaffMember" ADD COLUMN "leftOn" DATE;
ALTER TABLE "StaffMember" ADD COLUMN "userId" TEXT;

ALTER TABLE "AttendanceRecord" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "SalaryRecord" ADD COLUMN "dueOverridePaise" INTEGER;
ALTER TABLE "SalaryRecord" ADD COLUMN "carriedOverridePaise" INTEGER;
ALTER TABLE "SalaryRecord" ADD COLUMN "updatedById" TEXT;

CREATE TABLE "StaffPayEntry" (
    "id" TEXT NOT NULL,
    "staffMemberId" TEXT NOT NULL,
    "month" DATE NOT NULL,
    "kind" "StaffPayEntryKind" NOT NULL,
    "date" DATE NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffPayEntry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "StaffPayEntry_staffMemberId_month_idx" ON "StaffPayEntry"("staffMemberId", "month");

ALTER TABLE "StaffPayEntry" ADD CONSTRAINT "StaffPayEntry_staffMemberId_fkey" FOREIGN KEY ("staffMemberId") REFERENCES "StaffMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;
