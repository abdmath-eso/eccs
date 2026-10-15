-- The camera check understands any checklist item (15 Oct 2026). Written by hand.
--
-- "photoStandard" holds what a proof photo for the item must show, written once by AI
-- from the item's wording and kept: what must be in the photo, what done and not done
-- look like, whether a photo can show it at all, and whether the check is about staff,
-- with the wording it was made from (StoredPhotoStandard in packages/shared/src/ai.ts).
-- On a library suggestion it is kept so that every later pick copies it with no AI call.
-- Empty until first needed. Nothing existing is changed or removed.

ALTER TABLE "ChecklistItem" ADD COLUMN "photoStandard" JSONB;
ALTER TABLE "ChecklistLibraryItem" ADD COLUMN "photoStandard" JSONB;
