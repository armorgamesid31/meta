-- Create enums for identity-based magic link flow
CREATE TYPE "MagicLinkStatus" AS ENUM ('ACTIVE', 'USED', 'EXPIRED', 'REVOKED');
CREATE TYPE "IdentitySubjectType" AS ENUM ('PHONE', 'INSTAGRAM_ID');
CREATE TYPE "IdentitySessionStatus" AS ENUM ('ACTIVE', 'LINKED', 'CLOSED');
CREATE TYPE "IdentityBindingSource" AS ENUM ('MAGIC_LINK_REGISTER', 'ADMIN_MANUAL', 'SYSTEM');

-- Identity session table
CREATE TABLE "IdentitySession" (
    "id" TEXT NOT NULL,
    "salonId" INTEGER NOT NULL,
    "channel" "ChannelType" NOT NULL,
    "subjectType" "IdentitySubjectType" NOT NULL,
    "subjectRaw" TEXT NOT NULL,
    "subjectNormalized" TEXT NOT NULL,
    "conversationKey" TEXT,
    "canonicalUserId" TEXT,
    "customerId" INTEGER,
    "status" "IdentitySessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastInboundAt" TIMESTAMP(6),
    "lastOutboundAt" TIMESTAMP(6),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdentitySession_pkey" PRIMARY KEY ("id")
);

-- Identity binding table
CREATE TABLE "IdentityBinding" (
    "id" SERIAL NOT NULL,
    "salonId" INTEGER NOT NULL,
    "channel" "ChannelType" NOT NULL,
    "subjectNormalized" TEXT NOT NULL,
    "subjectRaw" TEXT NOT NULL,
    "customerId" INTEGER NOT NULL,
    "sessionId" TEXT,
    "source" "IdentityBindingSource" NOT NULL DEFAULT 'SYSTEM',
    "verifiedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdentityBinding_pkey" PRIMARY KEY ("id")
);

-- No backward compatibility: invalidate all previous magic links
TRUNCATE TABLE "MagicLink" RESTART IDENTITY;

-- Upgrade MagicLink to identity-based model
ALTER TABLE "MagicLink"
    ADD COLUMN "salonId" INTEGER NOT NULL,
    ADD COLUMN "channel" "ChannelType" NOT NULL,
    ADD COLUMN "subjectType" "IdentitySubjectType" NOT NULL,
    ADD COLUMN "subjectNormalized" TEXT NOT NULL,
    ADD COLUMN "status" "MagicLinkStatus" NOT NULL DEFAULT 'ACTIVE',
    ADD COLUMN "identitySessionId" TEXT NOT NULL,
    ADD COLUMN "usedByCustomerId" INTEGER;

-- Unique and lookup indexes
CREATE UNIQUE INDEX "uq_identity_session_subject" ON "IdentitySession"("salonId", "channel", "subjectNormalized");
CREATE INDEX "idx_identity_session_conv" ON "IdentitySession"("salonId", "conversationKey");
CREATE INDEX "idx_identity_session_canonical" ON "IdentitySession"("canonicalUserId");

CREATE UNIQUE INDEX "uq_identity_binding_subject" ON "IdentityBinding"("salonId", "channel", "subjectNormalized");
CREATE INDEX "idx_identity_binding_customer_salon" ON "IdentityBinding"("customerId", "salonId");
CREATE INDEX "idx_identity_binding_salon_channel_active" ON "IdentityBinding"("salonId", "channel", "isActive");

CREATE INDEX "idx_magiclink_lookup" ON "MagicLink"("salonId", "channel", "subjectNormalized", "status");
CREATE INDEX "idx_magiclink_session_created" ON "MagicLink"("identitySessionId", "createdAt");
CREATE INDEX "idx_magiclink_salon_status_exp" ON "MagicLink"("salonId", "status", "expiresAt");

-- Allow at most one ACTIVE magic link per identity+purpose
CREATE UNIQUE INDEX "uq_magiclink_active_subject"
ON "MagicLink"("salonId", "type", "channel", "subjectNormalized")
WHERE "status" = 'ACTIVE';

-- Foreign keys
ALTER TABLE "IdentitySession"
    ADD CONSTRAINT "IdentitySession_salonId_fkey"
    FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "IdentitySession"
    ADD CONSTRAINT "IdentitySession_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE "IdentityBinding"
    ADD CONSTRAINT "IdentityBinding_salonId_fkey"
    FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "IdentityBinding"
    ADD CONSTRAINT "IdentityBinding_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "IdentityBinding"
    ADD CONSTRAINT "IdentityBinding_sessionId_fkey"
    FOREIGN KEY ("sessionId") REFERENCES "IdentitySession"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE "MagicLink"
    ADD CONSTRAINT "MagicLink_salonId_fkey"
    FOREIGN KEY ("salonId") REFERENCES "Salon"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "MagicLink"
    ADD CONSTRAINT "MagicLink_identitySessionId_fkey"
    FOREIGN KEY ("identitySessionId") REFERENCES "IdentitySession"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "MagicLink"
    ADD CONSTRAINT "MagicLink_usedByCustomerId_fkey"
    FOREIGN KEY ("usedByCustomerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
