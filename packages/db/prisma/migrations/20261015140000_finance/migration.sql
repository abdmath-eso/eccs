-- ECCS's own books for the console's Finance page, 15 Oct 2026. Written by hand.
--
-- Five new tables: expenses (and wage advances), named budgets, the founders' money,
-- the opening cash balance, and the page's settings (the collection target and the
-- dollar rate the AI's cost is shown at). Money in is not kept here: invoices and
-- payments stay billing's, and the AI's cost stays in "AiRequest", so nothing is
-- entered twice. Sample rows carry "isSample" and a unique "sampleKey" so the sample
-- loader adds each once and all of them can be removed in one go. An expense may point
-- at its receipt (an "Attachment") and at a visit ("Job"); removing either only clears
-- the link. Nothing existing is changed.

CREATE TABLE "Expense" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'EXPENSE',
    "date" DATE NOT NULL,
    "category" TEXT,
    "type" TEXT,
    "vendor" TEXT NOT NULL,
    "description" TEXT,
    "amountPaise" INTEGER NOT NULL,
    "gstPaise" INTEGER NOT NULL DEFAULT 0,
    "paidVia" TEXT,
    "paidOn" DATE,
    "dueDate" DATE,
    "recoveredOn" DATE,
    "receiptId" TEXT,
    "visitId" TEXT,
    "enteredById" TEXT,
    "isSample" BOOLEAN NOT NULL DEFAULT false,
    "sampleKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Expense_sampleKey_key" ON "Expense"("sampleKey");
CREATE INDEX "Expense_date_idx" ON "Expense"("date");
CREATE INDEX "Expense_paidOn_idx" ON "Expense"("paidOn");
CREATE INDEX "Expense_visitId_idx" ON "Expense"("visitId");

ALTER TABLE "Expense" ADD CONSTRAINT "Expense_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "Attachment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "Budget" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "lines" JSONB NOT NULL,
    "plannedNet" JSONB,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isSample" BOOLEAN NOT NULL DEFAULT false,
    "sampleKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Budget_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Budget_sampleKey_key" ON "Budget"("sampleKey");

CREATE TABLE "FounderMoney" (
    "id" TEXT NOT NULL,
    "founder" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "direction" TEXT NOT NULL,
    "label" TEXT,
    "enteredById" TEXT,
    "isSample" BOOLEAN NOT NULL DEFAULT false,
    "sampleKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FounderMoney_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FounderMoney_sampleKey_key" ON "FounderMoney"("sampleKey");
CREATE INDEX "FounderMoney_date_idx" ON "FounderMoney"("date");

CREATE TABLE "CashOpening" (
    "id" TEXT NOT NULL,
    "asOf" DATE NOT NULL,
    "bankPaise" INTEGER NOT NULL DEFAULT 0,
    "cashPaise" INTEGER NOT NULL DEFAULT 0,
    "enteredById" TEXT,
    "isSample" BOOLEAN NOT NULL DEFAULT false,
    "sampleKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CashOpening_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CashOpening_sampleKey_key" ON "CashOpening"("sampleKey");

CREATE TABLE "FinanceSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "collectedTargetPercent" INTEGER NOT NULL DEFAULT 60,
    "usdToInrPaise" INTEGER NOT NULL DEFAULT 8800,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinanceSettings_pkey" PRIMARY KEY ("id")
);
