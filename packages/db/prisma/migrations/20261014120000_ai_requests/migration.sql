-- AI features (the Claude API), 14 Oct 2026. Written by hand.
--
-- 1. "AiRequest": one row per request to the AI, or per request refused before it
--    was sent (AI switched off, or a daily spending limit reached). Only facts are
--    kept: the feature, the model, who and where, the token counts, the cost in
--    millionths of a US dollar, how it ended and what the person later did with
--    the answer. Never the text, picture or answer. The daily limits are counted
--    from it. No foreign keys, so it never stops a user or outlet being removed.
-- 2. "AiScoreExplanation": "Why this score?" kept for the outlet, day and language.
-- 3. "translations" on support messages (Issue, IssueComment): each message's AI
--    translations, keyed by the reader's language, so each is made only once.
-- 4. "typedLanguage" on the restaurant's own checklist names and items, SOPs and
--    saved label names: the language typed in, when AI filled in the others.
-- Nothing existing is changed or removed.

CREATE TABLE "AiRequest" (
    "id" TEXT NOT NULL,
    "feature" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "userId" TEXT,
    "organizationId" TEXT,
    "outletId" TEXT,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "costMicroUsd" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL,
    "errorCode" TEXT,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "outcome" TEXT,

    CONSTRAINT "AiRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AiRequest_createdAt_idx" ON "AiRequest"("createdAt");

CREATE INDEX "AiRequest_outletId_createdAt_idx" ON "AiRequest"("outletId", "createdAt");

CREATE TABLE "AiScoreExplanation" (
    "id" TEXT NOT NULL,
    "outletId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "language" TEXT NOT NULL,
    "factsHash" TEXT NOT NULL,
    "sentences" JSONB NOT NULL,
    "aiRequestId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiScoreExplanation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AiScoreExplanation_outletId_date_language_key" ON "AiScoreExplanation"("outletId", "date", "language");

ALTER TABLE "Issue" ADD COLUMN "translations" JSONB;

ALTER TABLE "IssueComment" ADD COLUMN "translations" JSONB;

ALTER TABLE "ChecklistTemplate" ADD COLUMN "typedLanguage" TEXT;

ALTER TABLE "ChecklistItem" ADD COLUMN "typedLanguage" TEXT;

ALTER TABLE "SopTemplate" ADD COLUMN "typedLanguage" TEXT;

ALTER TABLE "FoodItem" ADD COLUMN "typedLanguage" TEXT;
