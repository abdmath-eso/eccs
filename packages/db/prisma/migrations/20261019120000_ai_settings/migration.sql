-- The AI usage page and the AI settings in the console (Stage F, 19 Oct 2026). Written by hand.
--
-- 1. AiRequest gains the prompt cache's tokens (reads and writes, part of "inputTokens" as
--    before) and where the request was asked from ("source", as the activity log names it).
-- 2. AiSettings: one row of settings changed from the console. No row means the defaults,
--    today's .env values, so nothing changes until the founder saves something.
-- 3. The requests already recorded get their "source": from their row in the activity log
--    where there is one, else from who asked. Nothing else existing is changed.

ALTER TABLE "AiRequest" ADD COLUMN "cacheReadTokens" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "cacheWriteTokens" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "source" TEXT;

CREATE TABLE "AiSettings" (
    "id" TEXT NOT NULL,
    "settings" JSONB NOT NULL,
    "history" JSONB NOT NULL DEFAULT '[]',
    "updatedById" TEXT,
    "updatedByName" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiSettings_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AiRequest_feature_createdAt_idx" ON "AiRequest"("feature", "createdAt");

-- Where each earlier request came from. First its own row in the activity log (15 Oct 2026 on).
UPDATE "AiRequest" r
SET "source" = a."source"
FROM "ActivityLog" a
WHERE a."entityType" = 'aiRequest' AND a."entityId" = r."id" AND r."source" IS NULL
  AND a."source" IN ('RESTAURANT_APP', 'SUPERVISOR_APP', 'CONSOLE', 'SYSTEM');

-- With nobody asking, it was the server's own work.
UPDATE "AiRequest" SET "source" = 'SYSTEM' WHERE "source" IS NULL AND "userId" IS NULL;

-- Else from the asker's role: a restaurant's people use the restaurant app; a Supervisor or BDE
-- their phone app; the Super Admin and Ops Manager the console.
UPDATE "AiRequest" r
SET "source" = CASE
    WHEN EXISTS (SELECT 1 FROM "Membership" m WHERE m."userId" = r."userId" AND m."role" IN ('OWNER', 'MANAGER', 'HEAD_CHEF')) THEN 'RESTAURANT_APP'
    WHEN EXISTS (SELECT 1 FROM "Membership" m WHERE m."userId" = r."userId" AND m."role" IN ('SUPERVISOR', 'BDE')) THEN 'SUPERVISOR_APP'
    ELSE 'CONSOLE'
  END
WHERE r."source" IS NULL AND EXISTS (SELECT 1 FROM "Membership" m WHERE m."userId" = r."userId");

-- A login removed since (a test's throwaway one): the helpers only the restaurant app has.
UPDATE "AiRequest" SET "source" = 'RESTAURANT_APP'
WHERE "source" IS NULL AND "feature" IN ('buddy', 'buddy-screen', 'photo-check', 'explain-score', 'translate-content', 'photo-standard');
