-- Terms and privacy acceptance, 14 Oct 2026. Written by hand.
--
-- One new table: each row is one person's agreement to one version of one legal
-- document (the Terms of Service, the Privacy Policy, and for the Owner the
-- Refund and Cancellation Policy and the Data Processing Terms). It is the record
-- of the contract, so the app only adds rows. "contentSha256" fingerprints the
-- exact words agreed to; "acceptedAt" is the server's time. A user who has agreed
-- to anything cannot be deleted until these rows are removed on purpose
-- (ON DELETE RESTRICT). Nothing existing is changed.

CREATE TABLE "LegalAcceptance" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "documentKey" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "contentSha256" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "role" "Role" NOT NULL,
    "organizationId" TEXT,
    "outletId" TEXT,
    "language" "Language" NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "deviceName" TEXT,
    "appVersion" TEXT,

    CONSTRAINT "LegalAcceptance_pkey" PRIMARY KEY ("id")
);

-- One agreement per person, document and version: agreeing again changes nothing.
CREATE UNIQUE INDEX "LegalAcceptance_userId_documentKey_version_key" ON "LegalAcceptance"("userId", "documentKey", "version");

CREATE INDEX "LegalAcceptance_userId_idx" ON "LegalAcceptance"("userId");

ALTER TABLE "LegalAcceptance" ADD CONSTRAINT "LegalAcceptance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
