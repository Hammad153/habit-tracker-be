ALTER TABLE "UserSubscription"
  ADD COLUMN "freeAccessEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "freeAccessGrantedBy" TEXT,
  ADD COLUMN "freeAccessGrantedAt" TIMESTAMP(3),
  ADD COLUMN "freeAccessExpiresAt" TIMESTAMP(3),
  ADD COLUMN "freeAccessRevokedAt" TIMESTAMP(3),
  ADD COLUMN "freeAccessReason" TEXT;

CREATE INDEX "UserSubscription_freeAccessEnabled_idx"
  ON "UserSubscription"("freeAccessEnabled");