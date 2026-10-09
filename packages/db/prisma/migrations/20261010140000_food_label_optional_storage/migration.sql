-- Food labels: where the food is stored becomes optional (founder, 9 Oct 2026). Written by hand.
--
-- Anyone in the kitchen can now make a label for whatever they want with only
-- a name and how long it keeps. Until now every food item and every label had
-- to say where it is stored, and was marked "chilled" when nobody had said,
-- so a label for something on a dry shelf would have printed "chilled".
-- From here on the column may be empty and nothing is assumed.
--
-- Items and labels that already exist keep the storage they have.

ALTER TABLE "FoodItem" ALTER COLUMN "storage" DROP DEFAULT;
ALTER TABLE "FoodItem" ALTER COLUMN "storage" DROP NOT NULL;

ALTER TABLE "FoodLabel" ALTER COLUMN "storage" DROP DEFAULT;
ALTER TABLE "FoodLabel" ALTER COLUMN "storage" DROP NOT NULL;
