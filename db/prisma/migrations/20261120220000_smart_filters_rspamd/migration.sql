-- Automatic built-in filters and stored spam analysis.
ALTER TABLE "Message"
  ADD COLUMN "category" TEXT NOT NULL DEFAULT 'PRIMARY',
  ADD COLUMN "categories" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "spamScore" DOUBLE PRECISION,
  ADD COLUMN "spamAction" TEXT,
  ADD COLUMN "spamEngine" TEXT,
  ADD COLUMN "spamSymbols" JSONB NOT NULL DEFAULT '[]';

CREATE INDEX "Message_userId_category_idx" ON "Message"("userId", "category");

-- Track positive user corrections ("not spam") in addition to spam reports.
ALTER TABLE "SenderStat"
  ADD COLUMN "hamReports" INTEGER NOT NULL DEFAULT 0;
