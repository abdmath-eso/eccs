-- Food labels (phase 1d, 10 Oct 2026). Written by hand, like the billing fields.
--
-- A food item gains its allergens, a note and which starter entry it came from.
-- A label gains a copy of the item's name, storage and allergens (so a later
-- change to the item never alters an old label), who prepared it by name, a
-- batch note, how many copies, whether the food is still there (LIVE) or was
-- used up or thrown away and why, a Manager's or Owner's reason for a longer
-- use-by, and an id chosen on the phone for labels made without signal.

CREATE TYPE "FoodLabelStatus" AS ENUM ('LIVE', 'USED', 'DISCARDED');
CREATE TYPE "FoodDiscardReason" AS ENUM ('EXPIRED', 'SPOILED', 'OTHER');

ALTER TABLE "FoodItem" ADD COLUMN "allergens" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "FoodItem" ADD COLUMN "note" TEXT;
ALTER TABLE "FoodItem" ADD COLUMN "starterKey" TEXT;
ALTER TABLE "FoodItem" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "FoodLabel" ADD COLUMN "itemName" TEXT NOT NULL DEFAULT '';
ALTER TABLE "FoodLabel" ADD COLUMN "storage" "StorageType" NOT NULL DEFAULT 'CHILLED';
ALTER TABLE "FoodLabel" ADD COLUMN "allergens" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "FoodLabel" ADD COLUMN "preparedByName" TEXT NOT NULL DEFAULT '';
ALTER TABLE "FoodLabel" ADD COLUMN "quantityNote" TEXT;
ALTER TABLE "FoodLabel" ADD COLUMN "copies" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "FoodLabel" ADD COLUMN "status" "FoodLabelStatus" NOT NULL DEFAULT 'LIVE';
ALTER TABLE "FoodLabel" ADD COLUMN "discardReason" "FoodDiscardReason";
ALTER TABLE "FoodLabel" ADD COLUMN "closeNote" TEXT;
ALTER TABLE "FoodLabel" ADD COLUMN "closedAt" TIMESTAMP(3);
ALTER TABLE "FoodLabel" ADD COLUMN "closedById" TEXT;
ALTER TABLE "FoodLabel" ADD COLUMN "overrideReason" TEXT;
ALTER TABLE "FoodLabel" ADD COLUMN "overrideById" TEXT;
ALTER TABLE "FoodLabel" ADD COLUMN "createdById" TEXT;
ALTER TABLE "FoodLabel" ADD COLUMN "clientId" TEXT;

-- Any label that already exists takes its item's name (English, or whatever language there is) and storage.
UPDATE "FoodLabel" AS label
SET "itemName" = COALESCE(item."name"->>'en', (SELECT value FROM jsonb_each_text(item."name") LIMIT 1), ''),
    "storage" = item."storage"
FROM "FoodItem" AS item
WHERE item."id" = label."foodItemId";

CREATE UNIQUE INDEX "FoodLabel_clientId_key" ON "FoodLabel"("clientId");
CREATE INDEX "FoodLabel_outletId_status_expiresAt_idx" ON "FoodLabel"("outletId", "status", "expiresAt");
