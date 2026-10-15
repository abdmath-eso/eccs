-- The activity log, 15 Oct 2026. Written by hand.
--
-- 1. "ActivityLog": one row for everything that happens in the restaurant app, the
--    Supervisor's app, the ECCS console, the AI and the server's own timed work, for
--    the console's Logs page (Super Admin and Ops Manager only). Names of the person,
--    restaurant and outlet are copied in as they were, so a renamed or removed one
--    still reads. Only safe facts are kept (see packages/shared/src/activity-log.ts):
--    never a PIN, code, token, password, key, request body, file, free text people
--    typed, what a checklist problem was, or anything about a staff member beyond the
--    action itself. No foreign keys, so it never stops anything being removed. Rows
--    older than ACTIVITY_LOG_DAYS (365 unless set) are deleted by a daily job.
-- 2. The AI history so far: one row for every existing "AiRequest", so the Logs page
--    does not start with an empty AI history. The source is worked out from the
--    person's role (a restaurant role: the restaurant app; a Supervisor: the
--    Supervisor's app; the Super Admin or Ops Manager: the console; no person: the
--    server). The camera nudge's verdict ("resultCode") is not copied.
-- Nothing existing is changed or removed. AuditLog (the restaurant's own attendance
-- trail) is a different table and is left as it is.

CREATE TABLE "ActivityLog" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "phoneAt" TIMESTAMP(3),
    "offline" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT NOT NULL,
    "actorUserId" TEXT,
    "actorName" TEXT,
    "actorRole" TEXT,
    "organizationId" TEXT,
    "organizationName" TEXT,
    "outletId" TEXT,
    "outletName" TEXT,
    "category" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "entityLabel" TEXT,
    "reference" TEXT,
    "result" TEXT NOT NULL,
    "method" TEXT,
    "route" TEXT,
    "statusCode" INTEGER,
    "durationMs" INTEGER,
    "details" JSONB,
    "ip" TEXT,
    "deviceId" TEXT,
    "client" TEXT,
    "appVersion" TEXT,
    "requestId" TEXT,
    "aiFeature" TEXT,
    "aiModel" TEXT,
    "aiStatus" TEXT,
    "aiOutcome" TEXT,
    "aiCostMicroUsd" INTEGER,

    CONSTRAINT "ActivityLog_pkey" PRIMARY KEY ("id")
);

-- Newest first, and by the columns the Logs page filters on most.
CREATE INDEX "ActivityLog_at_idx" ON "ActivityLog"("at");
CREATE INDEX "ActivityLog_organizationId_at_idx" ON "ActivityLog"("organizationId", "at");
CREATE INDEX "ActivityLog_outletId_at_idx" ON "ActivityLog"("outletId", "at");
CREATE INDEX "ActivityLog_actorUserId_at_idx" ON "ActivityLog"("actorUserId", "at");
CREATE INDEX "ActivityLog_category_at_idx" ON "ActivityLog"("category", "at");
CREATE INDEX "ActivityLog_source_at_idx" ON "ActivityLog"("source", "at");
CREATE INDEX "ActivityLog_result_at_idx" ON "ActivityLog"("result", "at");
CREATE INDEX "ActivityLog_entityType_entityId_idx" ON "ActivityLog"("entityType", "entityId");
CREATE INDEX "ActivityLog_reference_idx" ON "ActivityLog"("reference");
CREATE INDEX "ActivityLog_requestId_idx" ON "ActivityLog"("requestId");
CREATE INDEX "ActivityLog_aiFeature_at_idx" ON "ActivityLog"("aiFeature", "at");

-- The AI history so far.
INSERT INTO "ActivityLog" (
    "id", "at", "offline", "source",
    "actorUserId", "actorName", "actorRole",
    "organizationId", "organizationName", "outletId", "outletName",
    "category", "action", "entityType", "entityId", "result", "durationMs", "details",
    "aiFeature", "aiModel", "aiStatus", "aiOutcome", "aiCostMicroUsd"
)
SELECT
    gen_random_uuid()::text,
    r."createdAt",
    false,
    CASE
        WHEN r."userId" IS NULL OR mr.role_name IS NULL THEN 'SYSTEM'
        WHEN mr.role_name IN ('OWNER', 'MANAGER', 'HEAD_CHEF') THEN 'RESTAURANT_APP'
        WHEN mr.role_name = 'SUPERVISOR' THEN 'SUPERVISOR_APP'
        ELSE 'CONSOLE'
    END,
    r."userId",
    u."name",
    mr.role_name,
    COALESCE(r."organizationId", o."organizationId"),
    org."name",
    r."outletId",
    o."name",
    'ai',
    CASE r."feature"
        WHEN 'licence-reader' THEN 'ai.request.licenceReader'
        WHEN 'translate-support' THEN 'ai.request.translateSupport'
        WHEN 'translate-content' THEN 'ai.request.translateContent'
        WHEN 'explain-score' THEN 'ai.request.explainScore'
        WHEN 'monitoring-digest' THEN 'ai.request.monitoringDigest'
        WHEN 'inspection-summary' THEN 'ai.request.inspectionSummary'
        WHEN 'photo-check' THEN 'ai.request.photoCheck'
        ELSE 'ai.request.other'
    END,
    'aiRequest',
    r."id",
    CASE r."status"
        WHEN 'OK' THEN 'SUCCESS'
        WHEN 'OFF' THEN 'REFUSED'
        WHEN 'LIMIT' THEN 'REFUSED'
        ELSE 'FAILED'
    END,
    r."durationMs",
    jsonb_strip_nulls(jsonb_build_object(
        'feature', r."feature",
        'model', r."model",
        'status', r."status",
        'inputTokens', r."inputTokens",
        'outputTokens', r."outputTokens",
        'errorCode', r."errorCode",
        'outcome', r."outcome",
        'fromHistory', true
    )),
    r."feature",
    r."model",
    r."status",
    r."outcome",
    r."costMicroUsd"
FROM "AiRequest" r
LEFT JOIN "User" u ON u."id" = r."userId"
LEFT JOIN LATERAL (
    SELECT m."role"::text AS role_name
    FROM "Membership" m
    WHERE m."userId" = r."userId"
    ORDER BY array_position(ARRAY['SUPER_ADMIN', 'OPS_MANAGER', 'SUPERVISOR', 'OWNER', 'MANAGER', 'HEAD_CHEF']::text[], m."role"::text)
    LIMIT 1
) mr ON true
LEFT JOIN "Outlet" o ON o."id" = r."outletId"
LEFT JOIN "Organization" org ON org."id" = COALESCE(r."organizationId", o."organizationId");
