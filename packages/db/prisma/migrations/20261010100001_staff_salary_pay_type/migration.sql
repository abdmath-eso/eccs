-- Staff salary tracker, second part (phase 1d). Written by hand.
--
-- A month's pay record remembers how the person was paid that month (by the
-- month or by the day) beside the rate already held in "basePaise", so a later
-- change of pay never alters an earlier month.

ALTER TABLE "SalaryRecord" ADD COLUMN "payType" "StaffPayType" NOT NULL DEFAULT 'MONTHLY';
