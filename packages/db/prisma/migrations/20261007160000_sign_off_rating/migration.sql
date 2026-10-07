-- The restaurant rates the visit (1 to 5 stars) and may add a comment when signing it off.
ALTER TABLE "SignOff" ADD COLUMN "rating" INTEGER,
ADD COLUMN "comment" TEXT;
