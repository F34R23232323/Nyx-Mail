-- Instance administrators can manage hosted domains from Settings → Domains.
ALTER TABLE "User" ADD COLUMN "isAdmin" BOOLEAN NOT NULL DEFAULT false;

-- Preserve access for the existing installation owner. New installations make
-- the first account an administrator during signup.
UPDATE "User"
SET "isAdmin" = true
WHERE "id" = (
  SELECT "id" FROM "User" ORDER BY "createdAt" ASC, "id" ASC LIMIT 1
);

CREATE TABLE "MailDomain" (
    "id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "allowSignup" BOOLEAN NOT NULL DEFAULT false,
    "catchAllAddress" TEXT,
    "dkimSelector" TEXT,
    "dkimPublicKey" TEXT,
    "dkimPrivateKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MailDomain_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MailDomain_domain_key" ON "MailDomain"("domain");
CREATE INDEX "MailDomain_enabled_idx" ON "MailDomain"("enabled");
