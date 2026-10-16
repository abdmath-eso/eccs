-- Onboarding a new team member, 16 Oct 2026 (Stage D of the founders' business dashboards).
-- Written by hand, checked against `prisma migrate diff`.
--
-- A checklist template per team role (OnboardingTemplate and its tasks); each new hire's own
-- checklist, copied from it when their onboarding starts (Onboarding, OnboardingTask); the
-- joining file they fill in (JoiningFile: only an ID's last 4 digits are ever kept); the
-- documents they upload, accepted or sent back (JoiningDocument, with a new kind of file,
-- JOINING, that only the Super Admin and the person may open); their appointment letters
-- (AppointmentLetter, numbered ECCS/AL/2026/0001); the staff handbook's versions and who
-- accepted which (StaffHandbook, HandbookAcceptance); and the letter's terms
-- (OnboardingSettings). Everything hangs off the team member and goes with it.
--
-- Postgres lets a new value be added to an enum inside the migration's transaction as long as
-- nothing in the same transaction uses it, which nothing here does. Nothing existing changes.

-- AlterEnum
ALTER TYPE "AttachmentKind" ADD VALUE 'JOINING';

-- CreateTable
CREATE TABLE "OnboardingTemplate" (
    "id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "documents" JSONB NOT NULL,
    "isSample" BOOLEAN NOT NULL DEFAULT false,
    "sampleKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OnboardingTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnboardingTemplateTask" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "phase" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "daysFromJoining" INTEGER NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "auto" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OnboardingTemplateTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Onboarding" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "startedOn" DATE NOT NULL,
    "startedById" TEXT,
    "documents" JSONB NOT NULL,
    "isSample" BOOLEAN NOT NULL DEFAULT false,
    "sampleKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Onboarding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnboardingTask" (
    "id" TEXT NOT NULL,
    "onboardingId" TEXT NOT NULL,
    "phase" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "daysFromJoining" INTEGER NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "auto" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "doneAt" TIMESTAMP(3),
    "doneById" TEXT,
    "addedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OnboardingTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JoiningFile" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "dateOfBirth" DATE,
    "parentName" TEXT,
    "currentAddress" TEXT,
    "permanentSame" BOOLEAN,
    "permanentAddress" TEXT,
    "emergencyName" TEXT,
    "emergencyRelation" TEXT,
    "emergencyPhone" TEXT,
    "bloodGroup" TEXT,
    "uniformSize" TEXT,
    "idType" TEXT,
    "idLast4" TEXT,
    "pan" TEXT,
    "bankHolder" TEXT,
    "bankAccount" TEXT,
    "bankIfsc" TEXT,
    "previousEmployer" TEXT,
    "uan" TEXT,
    "esiNumber" TEXT,
    "education" TEXT,
    "updatedById" TEXT,
    "isSample" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JoiningFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JoiningDocument" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "attachmentId" TEXT,
    "reason" TEXT,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploadedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "isSample" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JoiningDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppointmentLetter" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "particulars" JSONB,
    "remadeFor" JSONB,
    "pdfKey" TEXT,
    "madeAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "madeById" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "acceptedById" TEXT,
    "acceptedHow" TEXT,
    "acceptedIp" TEXT,
    "acceptedSha256" TEXT,
    "signedScanId" TEXT,
    "replacedAt" TIMESTAMP(3),
    "replacedById" TEXT,
    "isSample" BOOLEAN NOT NULL DEFAULT false,
    "sampleKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppointmentLetter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffHandbook" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdById" TEXT,
    "isSample" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffHandbook_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HandbookAcceptance" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedById" TEXT,
    "sha256" TEXT NOT NULL,
    "isSample" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "HandbookAcceptance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnboardingSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "letter" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OnboardingSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OnboardingTemplate_role_key" ON "OnboardingTemplate"("role");

-- CreateIndex
CREATE UNIQUE INDEX "OnboardingTemplate_sampleKey_key" ON "OnboardingTemplate"("sampleKey");

-- CreateIndex
CREATE INDEX "OnboardingTemplateTask_templateId_position_idx" ON "OnboardingTemplateTask"("templateId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "Onboarding_memberId_key" ON "Onboarding"("memberId");

-- CreateIndex
CREATE UNIQUE INDEX "Onboarding_sampleKey_key" ON "Onboarding"("sampleKey");

-- CreateIndex
CREATE INDEX "OnboardingTask_onboardingId_idx" ON "OnboardingTask"("onboardingId");

-- CreateIndex
CREATE UNIQUE INDEX "JoiningFile_memberId_key" ON "JoiningFile"("memberId");

-- CreateIndex
CREATE UNIQUE INDEX "JoiningDocument_attachmentId_key" ON "JoiningDocument"("attachmentId");

-- CreateIndex
CREATE INDEX "JoiningDocument_memberId_kind_idx" ON "JoiningDocument"("memberId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "AppointmentLetter_number_key" ON "AppointmentLetter"("number");

-- CreateIndex
CREATE UNIQUE INDEX "AppointmentLetter_sampleKey_key" ON "AppointmentLetter"("sampleKey");

-- CreateIndex
CREATE INDEX "AppointmentLetter_memberId_idx" ON "AppointmentLetter"("memberId");

-- CreateIndex
CREATE UNIQUE INDEX "StaffHandbook_version_key" ON "StaffHandbook"("version");

-- CreateIndex
CREATE UNIQUE INDEX "HandbookAcceptance_memberId_version_key" ON "HandbookAcceptance"("memberId", "version");

-- AddForeignKey
ALTER TABLE "OnboardingTemplateTask" ADD CONSTRAINT "OnboardingTemplateTask_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "OnboardingTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Onboarding" ADD CONSTRAINT "Onboarding_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "TeamMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnboardingTask" ADD CONSTRAINT "OnboardingTask_onboardingId_fkey" FOREIGN KEY ("onboardingId") REFERENCES "Onboarding"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JoiningFile" ADD CONSTRAINT "JoiningFile_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "TeamMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JoiningDocument" ADD CONSTRAINT "JoiningDocument_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "TeamMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppointmentLetter" ADD CONSTRAINT "AppointmentLetter_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "TeamMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HandbookAcceptance" ADD CONSTRAINT "HandbookAcceptance_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "TeamMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

