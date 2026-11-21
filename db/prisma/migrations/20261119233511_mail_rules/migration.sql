-- CreateEnum
CREATE TYPE "RuleMatchType" AS ENUM ('ALL', 'ANY');

-- CreateTable
CREATE TABLE "MailRule" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "matchType" "RuleMatchType" NOT NULL DEFAULT 'ALL',
    "conditions" JSONB NOT NULL DEFAULT '[]',
    "actions" JSONB NOT NULL DEFAULT '[]',
    "stopProcessing" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MailRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MailRule_userId_enabled_priority_idx" ON "MailRule"("userId", "enabled", "priority");

-- AddForeignKey
ALTER TABLE "MailRule" ADD CONSTRAINT "MailRule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
