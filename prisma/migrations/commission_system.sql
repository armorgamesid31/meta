-- Commission/Prim sistemi — Staff ve Service'e oran alanı + 4 yeni tablo
-- (CommissionRule, CommissionBonusRule, CommissionEntry, CommissionPayout).
-- Hesaplama hiyerarşisi ve UI sözleşmesi schema.prisma'da açıklanıyor.

ALTER TABLE "Staff"
ADD COLUMN IF NOT EXISTS "commissionRate" DOUBLE PRECISION;

ALTER TABLE "Service"
ADD COLUMN IF NOT EXISTS "defaultCommissionRate" DOUBLE PRECISION;

CREATE TABLE IF NOT EXISTS "CommissionRule" (
  "id"          SERIAL PRIMARY KEY,
  "salonId"     INTEGER NOT NULL REFERENCES "Salon"("id") ON DELETE CASCADE,
  "staffId"     INTEGER NOT NULL REFERENCES "Staff"("id") ON DELETE CASCADE,
  "serviceId"   INTEGER REFERENCES "Service"("id") ON DELETE CASCADE,
  "rate"        DOUBLE PRECISION,
  "fixedAmount" DOUBLE PRECISION,
  "isExcluded"  BOOLEAN NOT NULL DEFAULT FALSE,
  "isActive"    BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt"   TIMESTAMP(6) DEFAULT NOW(),
  "updatedAt"   TIMESTAMP(6) DEFAULT NOW()
);

-- Aynı staff+service (veya staff+null) için tekil kural
CREATE UNIQUE INDEX IF NOT EXISTS "commission_rule_unique"
  ON "CommissionRule" ("salonId", "staffId", "serviceId");
CREATE INDEX IF NOT EXISTS "idx_commission_rule_salon_staff_active"
  ON "CommissionRule" ("salonId", "staffId", "isActive");

CREATE TABLE IF NOT EXISTS "CommissionBonusRule" (
  "id"          SERIAL PRIMARY KEY,
  "salonId"     INTEGER NOT NULL REFERENCES "Salon"("id") ON DELETE CASCADE,
  "staffId"     INTEGER REFERENCES "Staff"("id") ON DELETE CASCADE,
  "type"        VARCHAR(40) NOT NULL,
  "threshold"   DOUBLE PRECISION NOT NULL,
  "bonusAmount" DOUBLE PRECISION NOT NULL,
  "name"        VARCHAR(120),
  "isActive"    BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt"   TIMESTAMP(6) DEFAULT NOW(),
  "updatedAt"   TIMESTAMP(6) DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "idx_commission_bonus_rule_salon_active"
  ON "CommissionBonusRule" ("salonId", "isActive");

CREATE TABLE IF NOT EXISTS "CommissionPayout" (
  "id"            SERIAL PRIMARY KEY,
  "salonId"       INTEGER NOT NULL REFERENCES "Salon"("id") ON DELETE CASCADE,
  "staffId"       INTEGER NOT NULL REFERENCES "Staff"("id") ON DELETE CASCADE,
  "periodKey"     VARCHAR(7) NOT NULL,
  "totalAmount"   DOUBLE PRECISION NOT NULL,
  "paidAt"        TIMESTAMP(6) NOT NULL DEFAULT NOW(),
  "paidByUserId"  INTEGER,
  "paymentMethod" VARCHAR(40),
  "notes"         TEXT,
  "createdAt"     TIMESTAMP(6) DEFAULT NOW(),
  "updatedAt"     TIMESTAMP(6) DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS "commission_payout_unique"
  ON "CommissionPayout" ("salonId", "staffId", "periodKey");
CREATE INDEX IF NOT EXISTS "idx_commission_payout_salon_period"
  ON "CommissionPayout" ("salonId", "periodKey");

CREATE TABLE IF NOT EXISTS "CommissionEntry" (
  "id"                SERIAL PRIMARY KEY,
  "salonId"           INTEGER NOT NULL REFERENCES "Salon"("id") ON DELETE CASCADE,
  "staffId"           INTEGER NOT NULL REFERENCES "Staff"("id") ON DELETE CASCADE,
  "appointmentId"     INTEGER REFERENCES "Appointment"("id") ON DELETE SET NULL,
  "appointmentLineId" INTEGER REFERENCES "AppointmentLine"("id") ON DELETE SET NULL,
  "periodKey"         VARCHAR(7) NOT NULL,
  "baseAmount"        DOUBLE PRECISION NOT NULL DEFAULT 0,
  "rate"              DOUBLE PRECISION,
  "fixedAmount"       DOUBLE PRECISION,
  "amount"            DOUBLE PRECISION NOT NULL,
  "type"              VARCHAR(40) NOT NULL DEFAULT 'SERVICE',
  "status"            VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  "notes"             TEXT,
  "sourceRuleId"      INTEGER,
  "sourceBonusRuleId" INTEGER REFERENCES "CommissionBonusRule"("id") ON DELETE SET NULL,
  "payoutId"          INTEGER REFERENCES "CommissionPayout"("id") ON DELETE SET NULL,
  "paidAt"            TIMESTAMP(6),
  "paidByUserId"      INTEGER,
  "createdAt"         TIMESTAMP(6) DEFAULT NOW(),
  "updatedAt"         TIMESTAMP(6) DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "idx_commission_entry_salon_staff_period_status"
  ON "CommissionEntry" ("salonId", "staffId", "periodKey", "status");
CREATE INDEX IF NOT EXISTS "idx_commission_entry_salon_period_status"
  ON "CommissionEntry" ("salonId", "periodKey", "status");
CREATE INDEX IF NOT EXISTS "idx_commission_entry_appointment_line"
  ON "CommissionEntry" ("appointmentLineId");
