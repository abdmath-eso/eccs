-- The time of day of a visit is now a two-hour arrival window named by its start
-- ("1000" is 10:00 to 12:00) or AFTER_CLOSING. Rows saved as a part of the day move
-- to a window inside it.
UPDATE "Job" SET "scheduledSlot" = '1000' WHERE "scheduledSlot" = 'MORNING';
UPDATE "Job" SET "scheduledSlot" = '1400' WHERE "scheduledSlot" = 'AFTERNOON';
UPDATE "Job" SET "scheduledSlot" = '1800' WHERE "scheduledSlot" = 'EVENING';
UPDATE "Booking" SET "preferredSlot" = '1000' WHERE "preferredSlot" = 'MORNING';
UPDATE "Booking" SET "preferredSlot" = '1400' WHERE "preferredSlot" = 'AFTERNOON';
UPDATE "Booking" SET "preferredSlot" = '1800' WHERE "preferredSlot" = 'EVENING';
