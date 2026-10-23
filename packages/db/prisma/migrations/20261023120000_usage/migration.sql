-- The Usage page (23 Oct 2026). Written by hand. One new table, nothing existing changed: how
-- many times each logged-in person opened each screen of each app on each day.

CREATE TABLE "UsageDay" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "organizationId" TEXT,
    "app" TEXT NOT NULL,
    "screen" TEXT NOT NULL,
    "views" INTEGER NOT NULL DEFAULT 1,
    "firstAt" TIMESTAMP(3) NOT NULL,
    "lastAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UsageDay_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UsageDay_key_key" ON "UsageDay"("key");
CREATE INDEX "UsageDay_day_idx" ON "UsageDay"("day");
CREATE INDEX "UsageDay_organizationId_day_idx" ON "UsageDay"("organizationId", "day");
CREATE INDEX "UsageDay_userId_day_idx" ON "UsageDay"("userId", "day");
