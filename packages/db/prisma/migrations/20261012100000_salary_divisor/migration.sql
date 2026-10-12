-- The days a month's salary is divided by (12 Oct 2026).
--
-- Until now a monthly salary was always divided by the calendar days of the
-- month (28 to 31). The Owner can now choose, per outlet: the days in that
-- month (still the default), always 30, always 26, or another number.
--
--   * AttendanceSettings.salaryDivisorDays: empty means "the days in that
--     month"; a number means "always this many days".
--   * SalaryRecord.divisorDays: the number that month's pay was worked out
--     with, kept once a payment is recorded or the month is saved, so changing
--     the setting later does not rewrite a month already settled. Empty means
--     the month is still open and follows the outlet's setting.
--
-- Every month that already has a record was worked out with calendar days, so
-- it keeps exactly that: the number of days that month has. No joining dates
-- are guessed here; a person without one is counted from the day they were
-- added (see staff.ts).

ALTER TABLE "AttendanceSettings" ADD COLUMN "salaryDivisorDays" INTEGER;
ALTER TABLE "SalaryRecord" ADD COLUMN "divisorDays" INTEGER;

UPDATE "SalaryRecord"
SET "divisorDays" = EXTRACT(DAY FROM ("month" + INTERVAL '1 month' - INTERVAL '1 day'))::INTEGER
WHERE "payType" = 'MONTHLY';
