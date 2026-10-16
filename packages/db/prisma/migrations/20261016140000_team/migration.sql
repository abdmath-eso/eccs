-- Team for the console's Team page, 16 Oct 2026 (Stage C of the founders' business
-- dashboards). Written by hand.
--
-- ECCS's own team (the Ops Manager, Supervisors and BDEs; a founder only when given a
-- place on it): each login's area, joining and leaving dates and weekly day off; their
-- monthly salary, which can change from a date; and their leave. Removing a login takes
-- its team record, salaries, leave and salary rows with it (the app never removes a
-- login; people are marked as left instead).
--
-- A month's salary becomes a row of the Finance page's expense book, pointing at the team
-- member and the month (one row per person per month).
--
-- LeadFollowUp keeps every next step's due time from the moment it is set, for "follow-ups
-- on time": a lead itself keeps only its current next step. It goes with its lead.
--
-- Sample rows carry "isSample" (and a unique "sampleKey" where they need one), as the
-- Finance and Sales books do. Nothing existing is changed.

ALTER TABLE "Expense" ADD COLUMN "teamMemberId" TEXT;
ALTER TABLE "Expense" ADD COLUMN "salaryMonth" TEXT;

CREATE TABLE "LeadFollowUp" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "setAt" TIMESTAMP(3) NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "isSample" BOOLEAN NOT NULL DEFAULT false,
    "sampleKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadFollowUp_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TeamMember" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "area" TEXT,
    "joinedOn" DATE NOT NULL,
    "leftOn" DATE,
    "weeklyOff" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "isSample" BOOLEAN NOT NULL DEFAULT false,
    "sampleKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamMember_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TeamSalary" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "from" DATE NOT NULL,
    "monthlyPaise" INTEGER NOT NULL,
    "setById" TEXT,
    "isSample" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamSalary_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TeamLeave" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "from" DATE NOT NULL,
    "to" DATE NOT NULL,
    "reason" TEXT,
    "createdById" TEXT,
    "isSample" BOOLEAN NOT NULL DEFAULT false,
    "sampleKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamLeave_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TeamSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "onTimeTargetPercent" INTEGER NOT NULL DEFAULT 90,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamSettings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Expense_teamMemberId_salaryMonth_key" ON "Expense"("teamMemberId", "salaryMonth");
CREATE UNIQUE INDEX "LeadFollowUp_sampleKey_key" ON "LeadFollowUp"("sampleKey");
CREATE INDEX "LeadFollowUp_ownerId_dueAt_idx" ON "LeadFollowUp"("ownerId", "dueAt");
CREATE INDEX "LeadFollowUp_leadId_endedAt_idx" ON "LeadFollowUp"("leadId", "endedAt");
CREATE UNIQUE INDEX "TeamMember_userId_key" ON "TeamMember"("userId");
CREATE UNIQUE INDEX "TeamMember_sampleKey_key" ON "TeamMember"("sampleKey");
CREATE UNIQUE INDEX "TeamSalary_memberId_from_key" ON "TeamSalary"("memberId", "from");
CREATE UNIQUE INDEX "TeamLeave_sampleKey_key" ON "TeamLeave"("sampleKey");
CREATE INDEX "TeamLeave_memberId_from_idx" ON "TeamLeave"("memberId", "from");

ALTER TABLE "Expense" ADD CONSTRAINT "Expense_teamMemberId_fkey" FOREIGN KEY ("teamMemberId") REFERENCES "TeamMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeadFollowUp" ADD CONSTRAINT "LeadFollowUp_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TeamSalary" ADD CONSTRAINT "TeamSalary_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "TeamMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TeamLeave" ADD CONSTRAINT "TeamLeave_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "TeamMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;
