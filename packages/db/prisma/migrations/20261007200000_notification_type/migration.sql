-- A notification records what kind it is, and reminders carry a key so they are not repeated.
ALTER TABLE "Notification" ADD COLUMN "type" TEXT,
ADD COLUMN "dedupeKey" TEXT;

CREATE UNIQUE INDEX "Notification_userId_dedupeKey_key" ON "Notification"("userId", "dedupeKey");
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");
