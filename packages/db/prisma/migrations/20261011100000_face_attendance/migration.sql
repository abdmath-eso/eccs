-- Attendance by face. Written by hand.
--
-- Nobody marks attendance by hand any more: people clock in and out with their
-- face on the outlet's linked phone. This adds:
--   * AttendancePunch: every clock-in and clock-out, never deleted (voided instead);
--   * FaceTemplate: the encrypted face templates of enrolled staff (no photos);
--   * FaceConsent: each employee's own consent, kept as history;
--   * AttendanceSettings: an outlet's own full-day and half-day hours;
--   * on AttendanceRecord: where the day's status came from, the minutes worked
--     and what the Owner should look at;
--   * the PUNCH kind of attachment, for the photo taken at a punch.
--
-- Every existing attendance row was marked by hand, so it becomes an OWNER entry
-- (the default below), which the working-out from punches never overwrites.

CREATE TYPE "AttendanceSource" AS ENUM ('PUNCHES', 'OWNER');
CREATE TYPE "PunchKind" AS ENUM ('IN', 'OUT');
CREATE TYPE "PunchMethod" AS ENUM ('FACE', 'ASSISTED', 'CORRECTION');
CREATE TYPE "PunchFlag" AS ENUM ('UNSURE_MATCH', 'ASSISTED', 'NO_CLOCK_OUT', 'POSSIBLE_SPOOF', 'OFFLINE');

ALTER TYPE "AttachmentKind" ADD VALUE 'PUNCH';

ALTER TABLE "AttendanceRecord" ADD COLUMN "source" "AttendanceSource" NOT NULL DEFAULT 'OWNER';
ALTER TABLE "AttendanceRecord" ADD COLUMN "workedMinutes" INTEGER;
ALTER TABLE "AttendanceRecord" ADD COLUMN "flags" TEXT[] DEFAULT ARRAY[]::TEXT[];

CREATE TABLE "FaceTemplate" (
    "id" TEXT NOT NULL,
    "staffMemberId" TEXT NOT NULL,
    "vector" BYTEA NOT NULL,
    "modelId" TEXT NOT NULL,
    "quality" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FaceTemplate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FaceConsent" (
    "id" TEXT NOT NULL,
    "staffMemberId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "language" "Language" NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL,
    "acceptedBy" TEXT NOT NULL DEFAULT 'EMPLOYEE',
    "recordedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "endedReason" TEXT,
    "endedById" TEXT,

    CONSTRAINT "FaceConsent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AttendancePunch" (
    "id" TEXT NOT NULL,
    "outletId" TEXT NOT NULL,
    "staffMemberId" TEXT NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL,
    "kind" "PunchKind" NOT NULL,
    "method" "PunchMethod" NOT NULL,
    "score" DOUBLE PRECISION,
    "secondScore" DOUBLE PRECISION,
    "deviceId" TEXT,
    "photoId" TEXT,
    "flag" "PunchFlag",
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidedById" TEXT,
    "voidReason" TEXT,

    CONSTRAINT "AttendancePunch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AttendanceSettings" (
    "outletId" TEXT NOT NULL,
    "fullDayMinutes" INTEGER NOT NULL DEFAULT 480,
    "halfDayMinutes" INTEGER NOT NULL DEFAULT 240,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendanceSettings_pkey" PRIMARY KEY ("outletId")
);

CREATE INDEX "FaceTemplate_staffMemberId_idx" ON "FaceTemplate"("staffMemberId");
CREATE INDEX "FaceConsent_staffMemberId_createdAt_idx" ON "FaceConsent"("staffMemberId", "createdAt");
CREATE INDEX "AttendancePunch_staffMemberId_at_idx" ON "AttendancePunch"("staffMemberId", "at");
CREATE INDEX "AttendancePunch_outletId_at_idx" ON "AttendancePunch"("outletId", "at");
CREATE INDEX "AttendancePunch_outletId_flag_idx" ON "AttendancePunch"("outletId", "flag");

ALTER TABLE "FaceTemplate" ADD CONSTRAINT "FaceTemplate_staffMemberId_fkey" FOREIGN KEY ("staffMemberId") REFERENCES "StaffMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FaceConsent" ADD CONSTRAINT "FaceConsent_staffMemberId_fkey" FOREIGN KEY ("staffMemberId") REFERENCES "StaffMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AttendancePunch" ADD CONSTRAINT "AttendancePunch_staffMemberId_fkey" FOREIGN KEY ("staffMemberId") REFERENCES "StaffMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AttendancePunch" ADD CONSTRAINT "AttendancePunch_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AttendanceSettings" ADD CONSTRAINT "AttendanceSettings_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "Outlet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
