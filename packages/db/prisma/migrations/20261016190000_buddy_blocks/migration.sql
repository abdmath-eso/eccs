-- ECCS Buddy's refused messages, 16 Oct 2026 (security: throttling repeat offenders). Written by
-- hand. One row per message the scope screen refused (OFFTOPIC, ABUSE) or answer the output check
-- replaced (ANSWER), with no words at all. Nothing existing is changed.

CREATE TABLE "BuddyBlock" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT,
    "outletId" TEXT,
    "reason" TEXT NOT NULL,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BuddyBlock_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BuddyBlock_userId_createdAt_idx" ON "BuddyBlock"("userId", "createdAt");
CREATE INDEX "BuddyBlock_createdAt_idx" ON "BuddyBlock"("createdAt");
