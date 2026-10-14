-- The camera nudge judges the check (14 Oct 2026). Written by hand.
--
-- "resultCode" on AiRequest holds the kind of answer only, so ECCS can measure how
-- often the AI was right: for the camera nudge, its verdict (OK, BLURRED, TOO_DARK,
-- WRONG_SUBJECT, NOT_DONE or UNSURE), read with "outcome" (ACCEPTED = the photo was
-- retaken after the nudge, DISCARDED = "Keep it"). The reason shown to the person is
-- never stored. Empty for older rows and for features that do not set it.
-- Nothing existing is changed or removed.

ALTER TABLE "AiRequest" ADD COLUMN "resultCode" TEXT;
