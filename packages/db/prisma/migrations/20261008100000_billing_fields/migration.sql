-- What billing needs that the first schema did not have.
ALTER TABLE "Subscription"
  ADD COLUMN "pricePaise" INTEGER,
  ADD COLUMN "billingCycle" "BillingCycle",
  ADD COLUMN "currentPeriodStart" DATE,
  ADD COLUMN "currentPeriodEnd" DATE,
  ADD COLUMN "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "pendingPlanId" TEXT,
  ADD COLUMN "pausedAt" TIMESTAMP(3),
  ADD COLUMN "cancelledAt" TIMESTAMP(3);

ALTER TABLE "Invoice"
  ADD COLUMN "periodStart" DATE,
  ADD COLUMN "periodEnd" DATE,
  ADD COLUMN "billTo" JSONB,
  ADD COLUMN "placeOfSupply" TEXT,
  ADD COLUMN "notes" TEXT,
  ADD COLUMN "voidedAt" TIMESTAMP(3),
  ADD COLUMN "voidReason" TEXT;

ALTER TABLE "Payment"
  ADD COLUMN "gateway" TEXT,
  ADD COLUMN "failureReason" TEXT,
  ADD COLUMN "recordedById" TEXT;
