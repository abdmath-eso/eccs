-- Sales and the CRM for the console's Sales page, 15 Oct 2026. Written by hand.
--
-- A new ECCS role, BDE (the sales team), and five new tables: leads, each lead's
-- timeline of steps, quotes with a public link and their opens, the weekly targets the
-- Super Admin sets by hand, and the page's settings (the lowest each target can go).
-- A lead belongs to its owner (a user; removing a user who still owns leads is refused)
-- and may point at the client it became (removing the client only clears the link). A
-- lead's steps and quotes go with it. Sample rows carry "isSample" and a unique
-- "sampleKey", as the Finance books do. Nothing existing is changed.
--
-- Postgres lets a new value be added to an enum inside the migration's transaction as
-- long as nothing in the same transaction uses it, which nothing here does.

ALTER TYPE "Role" ADD VALUE 'BDE';

CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "businessName" TEXT NOT NULL,
    "area" TEXT,
    "address" TEXT,
    "contactName" TEXT,
    "contactPhone" TEXT,
    "kitchens" INTEGER NOT NULL DEFAULT 1,
    "source" TEXT NOT NULL,
    "referrerName" TEXT,
    "ownerId" TEXT NOT NULL,
    "createdById" TEXT,
    "stage" TEXT NOT NULL DEFAULT 'NEW',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "parkedAt" TIMESTAMP(3),
    "parkedUntil" DATE,
    "parkedReason" TEXT,
    "lostAt" TIMESTAMP(3),
    "lostReason" TEXT,
    "nextAction" TEXT,
    "nextActionAt" TIMESTAMP(3),
    "checkAt" TIMESTAMP(3),
    "checkWith" TEXT,
    "checkDoneAt" TIMESTAMP(3),
    "checkFindings" INTEGER,
    "organizationId" TEXT,
    "wonAt" TIMESTAMP(3),
    "planAt" TIMESTAMP(3),
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "score" INTEGER NOT NULL DEFAULT 0,
    "scoreSignals" JSONB,
    "scoredAt" TIMESTAMP(3),
    "isSample" BOOLEAN NOT NULL DEFAULT false,
    "sampleKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Lead_sampleKey_key" ON "Lead"("sampleKey");
CREATE INDEX "Lead_ownerId_status_idx" ON "Lead"("ownerId", "status");
CREATE INDEX "Lead_status_stage_idx" ON "Lead"("status", "stage");
CREATE INDEX "Lead_organizationId_idx" ON "Lead"("organizationId");
CREATE INDEX "Lead_createdAt_idx" ON "Lead"("createdAt");
CREATE INDEX "Lead_lastActivityAt_idx" ON "Lead"("lastActivityAt");

ALTER TABLE "Lead" ADD CONSTRAINT "Lead_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "LeadActivity" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "byId" TEXT,
    "note" TEXT,
    "fromStage" TEXT,
    "toStage" TEXT,
    "checkAt" TIMESTAMP(3),
    "checkWith" TEXT,
    "findings" INTEGER,
    "amountPaise" INTEGER,
    "quoteId" TEXT,
    "signal" TEXT,
    "rating" INTEGER,
    "sameDay" BOOLEAN,
    "isSample" BOOLEAN NOT NULL DEFAULT false,
    "sampleKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadActivity_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LeadActivity_sampleKey_key" ON "LeadActivity"("sampleKey");
CREATE INDEX "LeadActivity_leadId_at_idx" ON "LeadActivity"("leadId", "at");
CREATE INDEX "LeadActivity_kind_at_idx" ON "LeadActivity"("kind", "at");
CREATE INDEX "LeadActivity_byId_at_idx" ON "LeadActivity"("byId", "at");

ALTER TABLE "LeadActivity" ADD CONSTRAINT "LeadActivity_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "Quote" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "lines" JSONB NOT NULL,
    "subtotalPaise" INTEGER NOT NULL,
    "gstPaise" INTEGER NOT NULL,
    "totalPaise" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "token" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3),
    "validUntil" DATE,
    "openCount" INTEGER NOT NULL DEFAULT 0,
    "firstOpenedAt" TIMESTAMP(3),
    "lastOpenedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "isSample" BOOLEAN NOT NULL DEFAULT false,
    "sampleKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Quote_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Quote_number_key" ON "Quote"("number");
CREATE UNIQUE INDEX "Quote_token_key" ON "Quote"("token");
CREATE UNIQUE INDEX "Quote_sampleKey_key" ON "Quote"("sampleKey");
CREATE INDEX "Quote_leadId_idx" ON "Quote"("leadId");

ALTER TABLE "Quote" ADD CONSTRAINT "Quote_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "SalesTarget" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "weekStart" DATE NOT NULL,
    "leads" INTEGER,
    "checks" INTEGER,
    "firstJobs" INTEGER,
    "plans" INTEGER,
    "setById" TEXT,
    "isSample" BOOLEAN NOT NULL DEFAULT false,
    "sampleKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesTarget_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SalesTarget_sampleKey_key" ON "SalesTarget"("sampleKey");
CREATE UNIQUE INDEX "SalesTarget_userId_weekStart_key" ON "SalesTarget"("userId", "weekStart");

ALTER TABLE "SalesTarget" ADD CONSTRAINT "SalesTarget_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "SalesSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "floorLeads" INTEGER NOT NULL DEFAULT 10,
    "floorChecks" INTEGER NOT NULL DEFAULT 3,
    "floorFirstJobs" INTEGER NOT NULL DEFAULT 1,
    "floorPlans" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesSettings_pkey" PRIMARY KEY ("id")
);
