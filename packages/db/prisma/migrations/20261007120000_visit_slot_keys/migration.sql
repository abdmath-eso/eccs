-- The time of day of a visit was free text ("after closing"). It is now one of
-- MORNING, AFTERNOON, EVENING, AFTER_CLOSING so the apps can show it in any language.
UPDATE "Job" SET "scheduledSlot" = 'AFTER_CLOSING' WHERE lower("scheduledSlot") = 'after closing';
UPDATE "Booking" SET "preferredSlot" = 'AFTER_CLOSING' WHERE lower("preferredSlot") = 'after closing';
UPDATE "Booking" SET "preferredSlot" = 'MORNING' WHERE lower("preferredSlot") = 'morning';
