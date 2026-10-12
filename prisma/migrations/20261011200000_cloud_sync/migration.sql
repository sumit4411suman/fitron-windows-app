-- Cloud sync between fitron.in and FITRON for Windows (docs/local-windows/SYNC.md). Additive only: six new tables, and
-- on every synced table a trigger that records each change in "SyncChange" inside the same transaction as the change
-- (the transactional outbox). The triggers are generated from src/lib/sync/entities.ts by
-- `npx tsx scripts/sync-schema.ts --triggers pg`; src/lib/sync/sync-schema.test.ts checks every synced table has one.

-- CreateTable
CREATE TABLE "SyncChange" (
    "seq" BIGSERIAL NOT NULL,
    "changeId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "op" TEXT NOT NULL,
    "data" JSONB,
    "origin" TEXT NOT NULL DEFAULT 'cloud',
    "status" TEXT NOT NULL DEFAULT 'DONE',
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncChange_pkey" PRIMARY KEY ("seq")
);

-- CreateTable
CREATE TABLE "SyncDevice" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "deviceNo" INTEGER NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "linkedById" TEXT NOT NULL,
    "installationId" TEXT,
    "linkedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMPTZ,
    "pulledSeq" BIGINT NOT NULL DEFAULT 0,
    "resyncAt" TIMESTAMPTZ,
    "revokedAt" TIMESTAMPTZ,

    CONSTRAINT "SyncDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncApplied" (
    "changeId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "appliedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncApplied_pkey" PRIMARY KEY ("changeId")
);

-- CreateTable
CREATE TABLE "SyncState" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "linked" BOOLEAN NOT NULL DEFAULT false,
    "cloudUrl" TEXT NOT NULL DEFAULT '',
    "orgId" TEXT NOT NULL DEFAULT '',
    "deviceId" TEXT NOT NULL DEFAULT '',
    "deviceNo" INTEGER NOT NULL DEFAULT 0,
    "token" BYTEA,
    "linkedEmail" TEXT NOT NULL DEFAULT '',
    "linkedAt" TIMESTAMPTZ,
    "pulledSeq" BIGINT NOT NULL DEFAULT 0,
    "needsSnapshot" BOOLEAN NOT NULL DEFAULT false,
    "lastPushAt" TIMESTAMPTZ,
    "lastPullAt" TIMESTAMPTZ,
    "lastOkAt" TIMESTAMPTZ,
    "lastError" TEXT,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "appliedSeq" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "SyncState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncVersion" (
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "version" BIGINT NOT NULL,

    CONSTRAINT "SyncVersion_pkey" PRIMARY KEY ("entity","entityId")
);

-- CreateTable
CREATE TABLE "SyncConflict" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "ours" JSONB,
    "theirs" JSONB,
    "fields" TEXT NOT NULL DEFAULT '',
    "deviceId" TEXT NOT NULL DEFAULT '',
    "changeId" TEXT NOT NULL DEFAULT '',
    "openedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMPTZ,
    "resolvedById" TEXT,
    "resolution" TEXT,

    CONSTRAINT "SyncConflict_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SyncChange_changeId_key" ON "SyncChange"("changeId");

-- CreateIndex
CREATE INDEX "SyncChange_orgId_seq_idx" ON "SyncChange"("orgId", "seq");

-- CreateIndex
CREATE INDEX "SyncChange_orgId_entity_entityId_seq_idx" ON "SyncChange"("orgId", "entity", "entityId", "seq");

-- CreateIndex
CREATE INDEX "SyncChange_status_seq_idx" ON "SyncChange"("status", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "SyncDevice_tokenHash_key" ON "SyncDevice"("tokenHash");

-- CreateIndex
CREATE INDEX "SyncDevice_orgId_idx" ON "SyncDevice"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "SyncDevice_orgId_deviceNo_key" ON "SyncDevice"("orgId", "deviceNo");

-- CreateIndex
CREATE INDEX "SyncApplied_orgId_appliedAt_idx" ON "SyncApplied"("orgId", "appliedAt");

-- CreateIndex
CREATE INDEX "SyncConflict_orgId_resolvedAt_idx" ON "SyncConflict"("orgId", "resolvedAt");

-- CreateIndex
CREATE INDEX "SyncConflict_entity_entityId_idx" ON "SyncConflict"("entity", "entityId");


-- Row-level security, as on every table (see 20261005180000_row_level_security).
ALTER TABLE "SyncChange" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SyncDevice" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SyncApplied" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SyncState" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SyncVersion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SyncConflict" ENABLE ROW LEVEL SECURITY;

-- Change capture.
CREATE FUNCTION "fitron_sync_Branch"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  r record;
  org text;
BEGIN
  IF COALESCE(current_setting('fitron.allow_delete', true), '') <> '' THEN RETURN NULL; END IF;
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
  IF TG_OP = 'UPDATE' AND (to_jsonb(NEW)) = (to_jsonb(OLD)) THEN RETURN NULL; END IF;
  org := r."orgId";
  IF org IS NULL THEN RETURN NULL; END IF;
  INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "data", "origin", "status", "attempts", "createdAt")
  VALUES (gen_random_uuid()::text, org, 'Branch', r."id", CASE WHEN TG_OP = 'DELETE' THEN 'delete' ELSE 'upsert' END,
          CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END,
          COALESCE(NULLIF(current_setting('fitron.sync_origin', true), ''), 'cloud'), 'DONE', 0, now());
  RETURN NULL;
END
$$;
CREATE TRIGGER "fitron_sync" AFTER INSERT OR UPDATE OR DELETE ON "Branch" FOR EACH ROW EXECUTE FUNCTION "fitron_sync_Branch"();

CREATE FUNCTION "fitron_sync_User"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  r record;
  org text;
BEGIN
  IF COALESCE(current_setting('fitron.allow_delete', true), '') <> '' THEN RETURN NULL; END IF;
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
  IF TG_OP = 'UPDATE' AND (to_jsonb(NEW) - 'passwordHash' - 'totpSecret' - 'totpEnabledAt' - 'totpLastStep' - 'lastLoginAt' - 'emailVerifiedAt') = (to_jsonb(OLD) - 'passwordHash' - 'totpSecret' - 'totpEnabledAt' - 'totpLastStep' - 'lastLoginAt' - 'emailVerifiedAt') THEN RETURN NULL; END IF;
  org := r."orgId";
  IF org IS NULL THEN RETURN NULL; END IF;
  INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "data", "origin", "status", "attempts", "createdAt")
  VALUES (gen_random_uuid()::text, org, 'User', r."id", CASE WHEN TG_OP = 'DELETE' THEN 'delete' ELSE 'upsert' END,
          CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) - 'passwordHash' - 'totpSecret' - 'totpEnabledAt' - 'totpLastStep' - 'lastLoginAt' - 'emailVerifiedAt' END,
          COALESCE(NULLIF(current_setting('fitron.sync_origin', true), ''), 'cloud'), 'DONE', 0, now());
  RETURN NULL;
END
$$;
CREATE TRIGGER "fitron_sync" AFTER INSERT OR UPDATE OR DELETE ON "User" FOR EACH ROW EXECUTE FUNCTION "fitron_sync_User"();

CREATE FUNCTION "fitron_sync_UserBranch"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  r record;
  org text;
BEGIN
  IF COALESCE(current_setting('fitron.allow_delete', true), '') <> '' THEN RETURN NULL; END IF;
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
  IF TG_OP = 'UPDATE' AND (to_jsonb(NEW)) = (to_jsonb(OLD)) THEN RETURN NULL; END IF;
  org := (SELECT "orgId" FROM "User" WHERE "id" = r."userId");
  IF org IS NULL THEN RETURN NULL; END IF;
  INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "data", "origin", "status", "attempts", "createdAt")
  VALUES (gen_random_uuid()::text, org, 'UserBranch', r."userId" || '|' || r."branchId", CASE WHEN TG_OP = 'DELETE' THEN 'delete' ELSE 'upsert' END,
          CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END,
          COALESCE(NULLIF(current_setting('fitron.sync_origin', true), ''), 'cloud'), 'DONE', 0, now());
  RETURN NULL;
END
$$;
CREATE TRIGGER "fitron_sync" AFTER INSERT OR UPDATE OR DELETE ON "UserBranch" FOR EACH ROW EXECUTE FUNCTION "fitron_sync_UserBranch"();

CREATE FUNCTION "fitron_sync_Setting"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  r record;
  org text;
BEGIN
  IF COALESCE(current_setting('fitron.allow_delete', true), '') <> '' THEN RETURN NULL; END IF;
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
  IF r."key" IN ('localRecovery', 'whatsapp', 'whatsapp_cloud', 'whatsapp_connector', 'wa_auto_runs', 'updates') THEN RETURN NULL; END IF;
  IF TG_OP = 'UPDATE' AND (to_jsonb(NEW)) = (to_jsonb(OLD)) THEN RETURN NULL; END IF;
  org := r."orgId";
  IF org IS NULL THEN RETURN NULL; END IF;
  INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "data", "origin", "status", "attempts", "createdAt")
  VALUES (gen_random_uuid()::text, org, 'Setting', r."orgId" || '|' || r."key", CASE WHEN TG_OP = 'DELETE' THEN 'delete' ELSE 'upsert' END,
          CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END,
          COALESCE(NULLIF(current_setting('fitron.sync_origin', true), ''), 'cloud'), 'DONE', 0, now());
  RETURN NULL;
END
$$;
CREATE TRIGGER "fitron_sync" AFTER INSERT OR UPDATE OR DELETE ON "Setting" FOR EACH ROW EXECUTE FUNCTION "fitron_sync_Setting"();

CREATE FUNCTION "fitron_sync_MonthLock"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  r record;
  org text;
BEGIN
  IF COALESCE(current_setting('fitron.allow_delete', true), '') <> '' THEN RETURN NULL; END IF;
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
  IF TG_OP = 'UPDATE' AND (to_jsonb(NEW)) = (to_jsonb(OLD)) THEN RETURN NULL; END IF;
  org := (SELECT "orgId" FROM "Branch" WHERE "id" = r."branchId");
  IF org IS NULL THEN RETURN NULL; END IF;
  INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "data", "origin", "status", "attempts", "createdAt")
  VALUES (gen_random_uuid()::text, org, 'MonthLock', r."branchId" || '|' || r."month", CASE WHEN TG_OP = 'DELETE' THEN 'delete' ELSE 'upsert' END,
          CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END,
          COALESCE(NULLIF(current_setting('fitron.sync_origin', true), ''), 'cloud'), 'DONE', 0, now());
  RETURN NULL;
END
$$;
CREATE TRIGGER "fitron_sync" AFTER INSERT OR UPDATE OR DELETE ON "MonthLock" FOR EACH ROW EXECUTE FUNCTION "fitron_sync_MonthLock"();

CREATE FUNCTION "fitron_sync_MembershipPlan"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  r record;
  org text;
BEGIN
  IF COALESCE(current_setting('fitron.allow_delete', true), '') <> '' THEN RETURN NULL; END IF;
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
  IF TG_OP = 'UPDATE' AND (to_jsonb(NEW)) = (to_jsonb(OLD)) THEN RETURN NULL; END IF;
  org := r."orgId";
  IF org IS NULL THEN RETURN NULL; END IF;
  INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "data", "origin", "status", "attempts", "createdAt")
  VALUES (gen_random_uuid()::text, org, 'MembershipPlan', r."id", CASE WHEN TG_OP = 'DELETE' THEN 'delete' ELSE 'upsert' END,
          CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END,
          COALESCE(NULLIF(current_setting('fitron.sync_origin', true), ''), 'cloud'), 'DONE', 0, now());
  RETURN NULL;
END
$$;
CREATE TRIGGER "fitron_sync" AFTER INSERT OR UPDATE OR DELETE ON "MembershipPlan" FOR EACH ROW EXECUTE FUNCTION "fitron_sync_MembershipPlan"();

CREATE FUNCTION "fitron_sync_PlanPrice"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  r record;
  org text;
BEGIN
  IF COALESCE(current_setting('fitron.allow_delete', true), '') <> '' THEN RETURN NULL; END IF;
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
  IF TG_OP = 'UPDATE' AND (to_jsonb(NEW)) = (to_jsonb(OLD)) THEN RETURN NULL; END IF;
  org := (SELECT "orgId" FROM "MembershipPlan" WHERE "id" = r."planId");
  IF org IS NULL THEN RETURN NULL; END IF;
  INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "data", "origin", "status", "attempts", "createdAt")
  VALUES (gen_random_uuid()::text, org, 'PlanPrice', r."planId" || '|' || r."category", CASE WHEN TG_OP = 'DELETE' THEN 'delete' ELSE 'upsert' END,
          CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END,
          COALESCE(NULLIF(current_setting('fitron.sync_origin', true), ''), 'cloud'), 'DONE', 0, now());
  RETURN NULL;
END
$$;
CREATE TRIGGER "fitron_sync" AFTER INSERT OR UPDATE OR DELETE ON "PlanPrice" FOR EACH ROW EXECUTE FUNCTION "fitron_sync_PlanPrice"();

CREATE FUNCTION "fitron_sync_WorkoutPlan"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  r record;
  org text;
BEGIN
  IF COALESCE(current_setting('fitron.allow_delete', true), '') <> '' THEN RETURN NULL; END IF;
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
  IF TG_OP = 'UPDATE' AND (to_jsonb(NEW)) = (to_jsonb(OLD)) THEN RETURN NULL; END IF;
  org := r."orgId";
  IF org IS NULL THEN RETURN NULL; END IF;
  INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "data", "origin", "status", "attempts", "createdAt")
  VALUES (gen_random_uuid()::text, org, 'WorkoutPlan', r."id", CASE WHEN TG_OP = 'DELETE' THEN 'delete' ELSE 'upsert' END,
          CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END,
          COALESCE(NULLIF(current_setting('fitron.sync_origin', true), ''), 'cloud'), 'DONE', 0, now());
  RETURN NULL;
END
$$;
CREATE TRIGGER "fitron_sync" AFTER INSERT OR UPDATE OR DELETE ON "WorkoutPlan" FOR EACH ROW EXECUTE FUNCTION "fitron_sync_WorkoutPlan"();

CREATE FUNCTION "fitron_sync_DietPlan"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  r record;
  org text;
BEGIN
  IF COALESCE(current_setting('fitron.allow_delete', true), '') <> '' THEN RETURN NULL; END IF;
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
  IF TG_OP = 'UPDATE' AND (to_jsonb(NEW)) = (to_jsonb(OLD)) THEN RETURN NULL; END IF;
  org := r."orgId";
  IF org IS NULL THEN RETURN NULL; END IF;
  INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "data", "origin", "status", "attempts", "createdAt")
  VALUES (gen_random_uuid()::text, org, 'DietPlan', r."id", CASE WHEN TG_OP = 'DELETE' THEN 'delete' ELSE 'upsert' END,
          CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END,
          COALESCE(NULLIF(current_setting('fitron.sync_origin', true), ''), 'cloud'), 'DONE', 0, now());
  RETURN NULL;
END
$$;
CREATE TRIGGER "fitron_sync" AFTER INSERT OR UPDATE OR DELETE ON "DietPlan" FOR EACH ROW EXECUTE FUNCTION "fitron_sync_DietPlan"();

CREATE FUNCTION "fitron_sync_Member"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  r record;
  org text;
BEGIN
  IF COALESCE(current_setting('fitron.allow_delete', true), '') <> '' THEN RETURN NULL; END IF;
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
  IF TG_OP = 'UPDATE' AND (to_jsonb(NEW)) = (to_jsonb(OLD)) THEN RETURN NULL; END IF;
  org := r."orgId";
  IF org IS NULL THEN RETURN NULL; END IF;
  INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "data", "origin", "status", "attempts", "createdAt")
  VALUES (gen_random_uuid()::text, org, 'Member', r."id", CASE WHEN TG_OP = 'DELETE' THEN 'delete' ELSE 'upsert' END,
          CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END,
          COALESCE(NULLIF(current_setting('fitron.sync_origin', true), ''), 'cloud'), 'DONE', 0, now());
  RETURN NULL;
END
$$;
CREATE TRIGGER "fitron_sync" AFTER INSERT OR UPDATE OR DELETE ON "Member" FOR EACH ROW EXECUTE FUNCTION "fitron_sync_Member"();

CREATE FUNCTION "fitron_sync_Offer"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  r record;
  org text;
BEGIN
  IF COALESCE(current_setting('fitron.allow_delete', true), '') <> '' THEN RETURN NULL; END IF;
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
  IF TG_OP = 'UPDATE' AND (to_jsonb(NEW)) = (to_jsonb(OLD)) THEN RETURN NULL; END IF;
  org := r."orgId";
  IF org IS NULL THEN RETURN NULL; END IF;
  INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "data", "origin", "status", "attempts", "createdAt")
  VALUES (gen_random_uuid()::text, org, 'Offer', r."id", CASE WHEN TG_OP = 'DELETE' THEN 'delete' ELSE 'upsert' END,
          CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END,
          COALESCE(NULLIF(current_setting('fitron.sync_origin', true), ''), 'cloud'), 'DONE', 0, now());
  RETURN NULL;
END
$$;
CREATE TRIGGER "fitron_sync" AFTER INSERT OR UPDATE OR DELETE ON "Offer" FOR EACH ROW EXECUTE FUNCTION "fitron_sync_Offer"();

CREATE FUNCTION "fitron_sync_Invoice"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  r record;
  org text;
BEGIN
  IF COALESCE(current_setting('fitron.allow_delete', true), '') <> '' THEN RETURN NULL; END IF;
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
  IF TG_OP = 'UPDATE' AND (to_jsonb(NEW)) = (to_jsonb(OLD)) THEN RETURN NULL; END IF;
  org := r."orgId";
  IF org IS NULL THEN RETURN NULL; END IF;
  INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "data", "origin", "status", "attempts", "createdAt")
  VALUES (gen_random_uuid()::text, org, 'Invoice', r."id", CASE WHEN TG_OP = 'DELETE' THEN 'delete' ELSE 'upsert' END,
          CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END,
          COALESCE(NULLIF(current_setting('fitron.sync_origin', true), ''), 'cloud'), 'DONE', 0, now());
  RETURN NULL;
END
$$;
CREATE TRIGGER "fitron_sync" AFTER INSERT OR UPDATE OR DELETE ON "Invoice" FOR EACH ROW EXECUTE FUNCTION "fitron_sync_Invoice"();

CREATE FUNCTION "fitron_sync_InvoiceItem"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  r record;
  org text;
BEGIN
  IF COALESCE(current_setting('fitron.allow_delete', true), '') <> '' THEN RETURN NULL; END IF;
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
  IF TG_OP = 'UPDATE' AND (to_jsonb(NEW)) = (to_jsonb(OLD)) THEN RETURN NULL; END IF;
  org := (SELECT "orgId" FROM "Invoice" WHERE "id" = r."invoiceId");
  IF org IS NULL THEN RETURN NULL; END IF;
  INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "data", "origin", "status", "attempts", "createdAt")
  VALUES (gen_random_uuid()::text, org, 'InvoiceItem', r."id", CASE WHEN TG_OP = 'DELETE' THEN 'delete' ELSE 'upsert' END,
          CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END,
          COALESCE(NULLIF(current_setting('fitron.sync_origin', true), ''), 'cloud'), 'DONE', 0, now());
  RETURN NULL;
END
$$;
CREATE TRIGGER "fitron_sync" AFTER INSERT OR UPDATE OR DELETE ON "InvoiceItem" FOR EACH ROW EXECUTE FUNCTION "fitron_sync_InvoiceItem"();

CREATE FUNCTION "fitron_sync_Membership"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  r record;
  org text;
BEGIN
  IF COALESCE(current_setting('fitron.allow_delete', true), '') <> '' THEN RETURN NULL; END IF;
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
  IF TG_OP = 'UPDATE' AND (to_jsonb(NEW)) = (to_jsonb(OLD)) THEN RETURN NULL; END IF;
  org := (SELECT "orgId" FROM "Branch" WHERE "id" = r."branchId");
  IF org IS NULL THEN RETURN NULL; END IF;
  INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "data", "origin", "status", "attempts", "createdAt")
  VALUES (gen_random_uuid()::text, org, 'Membership', r."id", CASE WHEN TG_OP = 'DELETE' THEN 'delete' ELSE 'upsert' END,
          CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END,
          COALESCE(NULLIF(current_setting('fitron.sync_origin', true), ''), 'cloud'), 'DONE', 0, now());
  RETURN NULL;
END
$$;
CREATE TRIGGER "fitron_sync" AFTER INSERT OR UPDATE OR DELETE ON "Membership" FOR EACH ROW EXECUTE FUNCTION "fitron_sync_Membership"();

CREATE FUNCTION "fitron_sync_Payment"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  r record;
  org text;
BEGIN
  IF COALESCE(current_setting('fitron.allow_delete', true), '') <> '' THEN RETURN NULL; END IF;
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
  IF TG_OP = 'UPDATE' AND (to_jsonb(NEW)) = (to_jsonb(OLD)) THEN RETURN NULL; END IF;
  org := r."orgId";
  IF org IS NULL THEN RETURN NULL; END IF;
  INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "data", "origin", "status", "attempts", "createdAt")
  VALUES (gen_random_uuid()::text, org, 'Payment', r."id", CASE WHEN TG_OP = 'DELETE' THEN 'delete' ELSE 'upsert' END,
          CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END,
          COALESCE(NULLIF(current_setting('fitron.sync_origin', true), ''), 'cloud'), 'DONE', 0, now());
  RETURN NULL;
END
$$;
CREATE TRIGGER "fitron_sync" AFTER INSERT OR UPDATE OR DELETE ON "Payment" FOR EACH ROW EXECUTE FUNCTION "fitron_sync_Payment"();

CREATE FUNCTION "fitron_sync_Purchase"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  r record;
  org text;
BEGIN
  IF COALESCE(current_setting('fitron.allow_delete', true), '') <> '' THEN RETURN NULL; END IF;
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
  IF TG_OP = 'UPDATE' AND (to_jsonb(NEW)) = (to_jsonb(OLD)) THEN RETURN NULL; END IF;
  org := r."orgId";
  IF org IS NULL THEN RETURN NULL; END IF;
  INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "data", "origin", "status", "attempts", "createdAt")
  VALUES (gen_random_uuid()::text, org, 'Purchase', r."id", CASE WHEN TG_OP = 'DELETE' THEN 'delete' ELSE 'upsert' END,
          CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END,
          COALESCE(NULLIF(current_setting('fitron.sync_origin', true), ''), 'cloud'), 'DONE', 0, now());
  RETURN NULL;
END
$$;
CREATE TRIGGER "fitron_sync" AFTER INSERT OR UPDATE OR DELETE ON "Purchase" FOR EACH ROW EXECUTE FUNCTION "fitron_sync_Purchase"();

CREATE FUNCTION "fitron_sync_Expense"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  r record;
  org text;
BEGIN
  IF COALESCE(current_setting('fitron.allow_delete', true), '') <> '' THEN RETURN NULL; END IF;
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
  IF TG_OP = 'UPDATE' AND (to_jsonb(NEW)) = (to_jsonb(OLD)) THEN RETURN NULL; END IF;
  org := r."orgId";
  IF org IS NULL THEN RETURN NULL; END IF;
  INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "data", "origin", "status", "attempts", "createdAt")
  VALUES (gen_random_uuid()::text, org, 'Expense', r."id", CASE WHEN TG_OP = 'DELETE' THEN 'delete' ELSE 'upsert' END,
          CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END,
          COALESCE(NULLIF(current_setting('fitron.sync_origin', true), ''), 'cloud'), 'DONE', 0, now());
  RETURN NULL;
END
$$;
CREATE TRIGGER "fitron_sync" AFTER INSERT OR UPDATE OR DELETE ON "Expense" FOR EACH ROW EXECUTE FUNCTION "fitron_sync_Expense"();

CREATE FUNCTION "fitron_sync_PurchaseLine"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  r record;
  org text;
BEGIN
  IF COALESCE(current_setting('fitron.allow_delete', true), '') <> '' THEN RETURN NULL; END IF;
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
  IF TG_OP = 'UPDATE' AND (to_jsonb(NEW)) = (to_jsonb(OLD)) THEN RETURN NULL; END IF;
  org := (SELECT "orgId" FROM "Purchase" WHERE "id" = r."purchaseId");
  IF org IS NULL THEN RETURN NULL; END IF;
  INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "data", "origin", "status", "attempts", "createdAt")
  VALUES (gen_random_uuid()::text, org, 'PurchaseLine', r."id", CASE WHEN TG_OP = 'DELETE' THEN 'delete' ELSE 'upsert' END,
          CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END,
          COALESCE(NULLIF(current_setting('fitron.sync_origin', true), ''), 'cloud'), 'DONE', 0, now());
  RETURN NULL;
END
$$;
CREATE TRIGGER "fitron_sync" AFTER INSERT OR UPDATE OR DELETE ON "PurchaseLine" FOR EACH ROW EXECUTE FUNCTION "fitron_sync_PurchaseLine"();

CREATE FUNCTION "fitron_sync_VendorPayment"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  r record;
  org text;
BEGIN
  IF COALESCE(current_setting('fitron.allow_delete', true), '') <> '' THEN RETURN NULL; END IF;
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
  IF TG_OP = 'UPDATE' AND (to_jsonb(NEW)) = (to_jsonb(OLD)) THEN RETURN NULL; END IF;
  org := (SELECT "orgId" FROM "Purchase" WHERE "id" = r."purchaseId");
  IF org IS NULL THEN RETURN NULL; END IF;
  INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "data", "origin", "status", "attempts", "createdAt")
  VALUES (gen_random_uuid()::text, org, 'VendorPayment', r."id", CASE WHEN TG_OP = 'DELETE' THEN 'delete' ELSE 'upsert' END,
          CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END,
          COALESCE(NULLIF(current_setting('fitron.sync_origin', true), ''), 'cloud'), 'DONE', 0, now());
  RETURN NULL;
END
$$;
CREATE TRIGGER "fitron_sync" AFTER INSERT OR UPDATE OR DELETE ON "VendorPayment" FOR EACH ROW EXECUTE FUNCTION "fitron_sync_VendorPayment"();

CREATE FUNCTION "fitron_sync_SalaryPayment"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  r record;
  org text;
BEGIN
  IF COALESCE(current_setting('fitron.allow_delete', true), '') <> '' THEN RETURN NULL; END IF;
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
  IF TG_OP = 'UPDATE' AND (to_jsonb(NEW)) = (to_jsonb(OLD)) THEN RETURN NULL; END IF;
  org := r."orgId";
  IF org IS NULL THEN RETURN NULL; END IF;
  INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "data", "origin", "status", "attempts", "createdAt")
  VALUES (gen_random_uuid()::text, org, 'SalaryPayment', r."id", CASE WHEN TG_OP = 'DELETE' THEN 'delete' ELSE 'upsert' END,
          CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END,
          COALESCE(NULLIF(current_setting('fitron.sync_origin', true), ''), 'cloud'), 'DONE', 0, now());
  RETURN NULL;
END
$$;
CREATE TRIGGER "fitron_sync" AFTER INSERT OR UPDATE OR DELETE ON "SalaryPayment" FOR EACH ROW EXECUTE FUNCTION "fitron_sync_SalaryPayment"();

CREATE FUNCTION "fitron_sync_Asset"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  r record;
  org text;
BEGIN
  IF COALESCE(current_setting('fitron.allow_delete', true), '') <> '' THEN RETURN NULL; END IF;
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
  IF TG_OP = 'UPDATE' AND (to_jsonb(NEW)) = (to_jsonb(OLD)) THEN RETURN NULL; END IF;
  org := r."orgId";
  IF org IS NULL THEN RETURN NULL; END IF;
  INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "data", "origin", "status", "attempts", "createdAt")
  VALUES (gen_random_uuid()::text, org, 'Asset', r."id", CASE WHEN TG_OP = 'DELETE' THEN 'delete' ELSE 'upsert' END,
          CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END,
          COALESCE(NULLIF(current_setting('fitron.sync_origin', true), ''), 'cloud'), 'DONE', 0, now());
  RETURN NULL;
END
$$;
CREATE TRIGGER "fitron_sync" AFTER INSERT OR UPDATE OR DELETE ON "Asset" FOR EACH ROW EXECUTE FUNCTION "fitron_sync_Asset"();

CREATE FUNCTION "fitron_sync_Product"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  r record;
  org text;
BEGIN
  IF COALESCE(current_setting('fitron.allow_delete', true), '') <> '' THEN RETURN NULL; END IF;
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
  IF TG_OP = 'UPDATE' AND (to_jsonb(NEW)) = (to_jsonb(OLD)) THEN RETURN NULL; END IF;
  org := r."orgId";
  IF org IS NULL THEN RETURN NULL; END IF;
  INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "data", "origin", "status", "attempts", "createdAt")
  VALUES (gen_random_uuid()::text, org, 'Product', r."id", CASE WHEN TG_OP = 'DELETE' THEN 'delete' ELSE 'upsert' END,
          CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END,
          COALESCE(NULLIF(current_setting('fitron.sync_origin', true), ''), 'cloud'), 'DONE', 0, now());
  RETURN NULL;
END
$$;
CREATE TRIGGER "fitron_sync" AFTER INSERT OR UPDATE OR DELETE ON "Product" FOR EACH ROW EXECUTE FUNCTION "fitron_sync_Product"();

CREATE FUNCTION "fitron_sync_StockMovement"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  r record;
  org text;
BEGIN
  IF COALESCE(current_setting('fitron.allow_delete', true), '') <> '' THEN RETURN NULL; END IF;
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
  IF TG_OP = 'UPDATE' AND (to_jsonb(NEW)) = (to_jsonb(OLD)) THEN RETURN NULL; END IF;
  org := (SELECT "orgId" FROM "Product" WHERE "id" = r."productId");
  IF org IS NULL THEN RETURN NULL; END IF;
  INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "data", "origin", "status", "attempts", "createdAt")
  VALUES (gen_random_uuid()::text, org, 'StockMovement', r."id", CASE WHEN TG_OP = 'DELETE' THEN 'delete' ELSE 'upsert' END,
          CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END,
          COALESCE(NULLIF(current_setting('fitron.sync_origin', true), ''), 'cloud'), 'DONE', 0, now());
  RETURN NULL;
END
$$;
CREATE TRIGGER "fitron_sync" AFTER INSERT OR UPDATE OR DELETE ON "StockMovement" FOR EACH ROW EXECUTE FUNCTION "fitron_sync_StockMovement"();

CREATE FUNCTION "fitron_sync_Lead"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  r record;
  org text;
BEGIN
  IF COALESCE(current_setting('fitron.allow_delete', true), '') <> '' THEN RETURN NULL; END IF;
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
  IF TG_OP = 'UPDATE' AND (to_jsonb(NEW)) = (to_jsonb(OLD)) THEN RETURN NULL; END IF;
  org := r."orgId";
  IF org IS NULL THEN RETURN NULL; END IF;
  INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "data", "origin", "status", "attempts", "createdAt")
  VALUES (gen_random_uuid()::text, org, 'Lead', r."id", CASE WHEN TG_OP = 'DELETE' THEN 'delete' ELSE 'upsert' END,
          CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END,
          COALESCE(NULLIF(current_setting('fitron.sync_origin', true), ''), 'cloud'), 'DONE', 0, now());
  RETURN NULL;
END
$$;
CREATE TRIGGER "fitron_sync" AFTER INSERT OR UPDATE OR DELETE ON "Lead" FOR EACH ROW EXECUTE FUNCTION "fitron_sync_Lead"();

CREATE FUNCTION "fitron_sync_ClassSlot"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  r record;
  org text;
BEGIN
  IF COALESCE(current_setting('fitron.allow_delete', true), '') <> '' THEN RETURN NULL; END IF;
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
  IF TG_OP = 'UPDATE' AND (to_jsonb(NEW)) = (to_jsonb(OLD)) THEN RETURN NULL; END IF;
  org := r."orgId";
  IF org IS NULL THEN RETURN NULL; END IF;
  INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "data", "origin", "status", "attempts", "createdAt")
  VALUES (gen_random_uuid()::text, org, 'ClassSlot', r."id", CASE WHEN TG_OP = 'DELETE' THEN 'delete' ELSE 'upsert' END,
          CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END,
          COALESCE(NULLIF(current_setting('fitron.sync_origin', true), ''), 'cloud'), 'DONE', 0, now());
  RETURN NULL;
END
$$;
CREATE TRIGGER "fitron_sync" AFTER INSERT OR UPDATE OR DELETE ON "ClassSlot" FOR EACH ROW EXECUTE FUNCTION "fitron_sync_ClassSlot"();

CREATE FUNCTION "fitron_sync_Booking"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  r record;
  org text;
BEGIN
  IF COALESCE(current_setting('fitron.allow_delete', true), '') <> '' THEN RETURN NULL; END IF;
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
  IF TG_OP = 'UPDATE' AND (to_jsonb(NEW)) = (to_jsonb(OLD)) THEN RETURN NULL; END IF;
  org := (SELECT "orgId" FROM "ClassSlot" WHERE "id" = r."classSlotId");
  IF org IS NULL THEN RETURN NULL; END IF;
  INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "data", "origin", "status", "attempts", "createdAt")
  VALUES (gen_random_uuid()::text, org, 'Booking', r."id", CASE WHEN TG_OP = 'DELETE' THEN 'delete' ELSE 'upsert' END,
          CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END,
          COALESCE(NULLIF(current_setting('fitron.sync_origin', true), ''), 'cloud'), 'DONE', 0, now());
  RETURN NULL;
END
$$;
CREATE TRIGGER "fitron_sync" AFTER INSERT OR UPDATE OR DELETE ON "Booking" FOR EACH ROW EXECUTE FUNCTION "fitron_sync_Booking"();

CREATE FUNCTION "fitron_sync_Attendance"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  r record;
  org text;
BEGIN
  IF COALESCE(current_setting('fitron.allow_delete', true), '') <> '' THEN RETURN NULL; END IF;
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
  IF TG_OP = 'UPDATE' AND (to_jsonb(NEW)) = (to_jsonb(OLD)) THEN RETURN NULL; END IF;
  org := (SELECT "orgId" FROM "Branch" WHERE "id" = r."branchId");
  IF org IS NULL THEN RETURN NULL; END IF;
  INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "data", "origin", "status", "attempts", "createdAt")
  VALUES (gen_random_uuid()::text, org, 'Attendance', r."id", CASE WHEN TG_OP = 'DELETE' THEN 'delete' ELSE 'upsert' END,
          CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END,
          COALESCE(NULLIF(current_setting('fitron.sync_origin', true), ''), 'cloud'), 'DONE', 0, now());
  RETURN NULL;
END
$$;
CREATE TRIGGER "fitron_sync" AFTER INSERT OR UPDATE OR DELETE ON "Attendance" FOR EACH ROW EXECUTE FUNCTION "fitron_sync_Attendance"();

CREATE FUNCTION "fitron_sync_ProgressLog"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  r record;
  org text;
BEGIN
  IF COALESCE(current_setting('fitron.allow_delete', true), '') <> '' THEN RETURN NULL; END IF;
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
  IF TG_OP = 'UPDATE' AND (to_jsonb(NEW)) = (to_jsonb(OLD)) THEN RETURN NULL; END IF;
  org := (SELECT "orgId" FROM "Member" WHERE "id" = r."memberId");
  IF org IS NULL THEN RETURN NULL; END IF;
  INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "data", "origin", "status", "attempts", "createdAt")
  VALUES (gen_random_uuid()::text, org, 'ProgressLog', r."id", CASE WHEN TG_OP = 'DELETE' THEN 'delete' ELSE 'upsert' END,
          CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END,
          COALESCE(NULLIF(current_setting('fitron.sync_origin', true), ''), 'cloud'), 'DONE', 0, now());
  RETURN NULL;
END
$$;
CREATE TRIGGER "fitron_sync" AFTER INSERT OR UPDATE OR DELETE ON "ProgressLog" FOR EACH ROW EXECUTE FUNCTION "fitron_sync_ProgressLog"();

CREATE FUNCTION "fitron_sync_PersonalRecord"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  r record;
  org text;
BEGIN
  IF COALESCE(current_setting('fitron.allow_delete', true), '') <> '' THEN RETURN NULL; END IF;
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
  IF TG_OP = 'UPDATE' AND (to_jsonb(NEW)) = (to_jsonb(OLD)) THEN RETURN NULL; END IF;
  org := r."orgId";
  IF org IS NULL THEN RETURN NULL; END IF;
  INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "data", "origin", "status", "attempts", "createdAt")
  VALUES (gen_random_uuid()::text, org, 'PersonalRecord', r."id", CASE WHEN TG_OP = 'DELETE' THEN 'delete' ELSE 'upsert' END,
          CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END,
          COALESCE(NULLIF(current_setting('fitron.sync_origin', true), ''), 'cloud'), 'DONE', 0, now());
  RETURN NULL;
END
$$;
CREATE TRIGGER "fitron_sync" AFTER INSERT OR UPDATE OR DELETE ON "PersonalRecord" FOR EACH ROW EXECUTE FUNCTION "fitron_sync_PersonalRecord"();

CREATE FUNCTION "fitron_sync_MembershipFreeze"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  r record;
  org text;
BEGIN
  IF COALESCE(current_setting('fitron.allow_delete', true), '') <> '' THEN RETURN NULL; END IF;
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
  IF TG_OP = 'UPDATE' AND (to_jsonb(NEW)) = (to_jsonb(OLD)) THEN RETURN NULL; END IF;
  org := r."orgId";
  IF org IS NULL THEN RETURN NULL; END IF;
  INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "data", "origin", "status", "attempts", "createdAt")
  VALUES (gen_random_uuid()::text, org, 'MembershipFreeze', r."id", CASE WHEN TG_OP = 'DELETE' THEN 'delete' ELSE 'upsert' END,
          CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END,
          COALESCE(NULLIF(current_setting('fitron.sync_origin', true), ''), 'cloud'), 'DONE', 0, now());
  RETURN NULL;
END
$$;
CREATE TRIGGER "fitron_sync" AFTER INSERT OR UPDATE OR DELETE ON "MembershipFreeze" FOR EACH ROW EXECUTE FUNCTION "fitron_sync_MembershipFreeze"();

CREATE FUNCTION "fitron_sync_WhatsAppTemplate"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  r record;
  org text;
BEGIN
  IF COALESCE(current_setting('fitron.allow_delete', true), '') <> '' THEN RETURN NULL; END IF;
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
  IF TG_OP = 'UPDATE' AND (to_jsonb(NEW)) = (to_jsonb(OLD)) THEN RETURN NULL; END IF;
  org := r."orgId";
  IF org IS NULL THEN RETURN NULL; END IF;
  INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "data", "origin", "status", "attempts", "createdAt")
  VALUES (gen_random_uuid()::text, org, 'WhatsAppTemplate', r."id", CASE WHEN TG_OP = 'DELETE' THEN 'delete' ELSE 'upsert' END,
          CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END,
          COALESCE(NULLIF(current_setting('fitron.sync_origin', true), ''), 'cloud'), 'DONE', 0, now());
  RETURN NULL;
END
$$;
CREATE TRIGGER "fitron_sync" AFTER INSERT OR UPDATE OR DELETE ON "WhatsAppTemplate" FOR EACH ROW EXECUTE FUNCTION "fitron_sync_WhatsAppTemplate"();

CREATE FUNCTION "fitron_sync_WhatsAppMessage"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  r record;
  org text;
BEGIN
  IF COALESCE(current_setting('fitron.allow_delete', true), '') <> '' THEN RETURN NULL; END IF;
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
  IF TG_OP = 'UPDATE' AND (to_jsonb(NEW)) = (to_jsonb(OLD)) THEN RETURN NULL; END IF;
  org := r."orgId";
  IF org IS NULL THEN RETURN NULL; END IF;
  INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "data", "origin", "status", "attempts", "createdAt")
  VALUES (gen_random_uuid()::text, org, 'WhatsAppMessage', r."id", CASE WHEN TG_OP = 'DELETE' THEN 'delete' ELSE 'upsert' END,
          CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END,
          COALESCE(NULLIF(current_setting('fitron.sync_origin', true), ''), 'cloud'), 'DONE', 0, now());
  RETURN NULL;
END
$$;
CREATE TRIGGER "fitron_sync" AFTER INSERT OR UPDATE OR DELETE ON "WhatsAppMessage" FOR EACH ROW EXECUTE FUNCTION "fitron_sync_WhatsAppMessage"();

CREATE FUNCTION "fitron_sync_AutopayMandate"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  r record;
  org text;
BEGIN
  IF COALESCE(current_setting('fitron.allow_delete', true), '') <> '' THEN RETURN NULL; END IF;
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
  IF TG_OP = 'UPDATE' AND (to_jsonb(NEW)) = (to_jsonb(OLD)) THEN RETURN NULL; END IF;
  org := r."orgId";
  IF org IS NULL THEN RETURN NULL; END IF;
  INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "data", "origin", "status", "attempts", "createdAt")
  VALUES (gen_random_uuid()::text, org, 'AutopayMandate', r."id", CASE WHEN TG_OP = 'DELETE' THEN 'delete' ELSE 'upsert' END,
          CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END,
          COALESCE(NULLIF(current_setting('fitron.sync_origin', true), ''), 'cloud'), 'DONE', 0, now());
  RETURN NULL;
END
$$;
CREATE TRIGGER "fitron_sync" AFTER INSERT OR UPDATE OR DELETE ON "AutopayMandate" FOR EACH ROW EXECUTE FUNCTION "fitron_sync_AutopayMandate"();

CREATE FUNCTION "fitron_sync_AutopayEvent"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  r record;
  org text;
BEGIN
  IF COALESCE(current_setting('fitron.allow_delete', true), '') <> '' THEN RETURN NULL; END IF;
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
  IF TG_OP = 'UPDATE' AND (to_jsonb(NEW)) = (to_jsonb(OLD)) THEN RETURN NULL; END IF;
  org := (SELECT "orgId" FROM "AutopayMandate" WHERE "id" = r."mandateId");
  IF org IS NULL THEN RETURN NULL; END IF;
  INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "data", "origin", "status", "attempts", "createdAt")
  VALUES (gen_random_uuid()::text, org, 'AutopayEvent', r."id", CASE WHEN TG_OP = 'DELETE' THEN 'delete' ELSE 'upsert' END,
          CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END,
          COALESCE(NULLIF(current_setting('fitron.sync_origin', true), ''), 'cloud'), 'DONE', 0, now());
  RETURN NULL;
END
$$;
CREATE TRIGGER "fitron_sync" AFTER INSERT OR UPDATE OR DELETE ON "AutopayEvent" FOR EACH ROW EXECUTE FUNCTION "fitron_sync_AutopayEvent"();

CREATE FUNCTION "fitron_sync_Notification"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  r record;
  org text;
BEGIN
  IF COALESCE(current_setting('fitron.allow_delete', true), '') <> '' THEN RETURN NULL; END IF;
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
  IF TG_OP = 'UPDATE' AND (to_jsonb(NEW)) = (to_jsonb(OLD)) THEN RETURN NULL; END IF;
  org := r."orgId";
  IF org IS NULL THEN RETURN NULL; END IF;
  INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "data", "origin", "status", "attempts", "createdAt")
  VALUES (gen_random_uuid()::text, org, 'Notification', r."id", CASE WHEN TG_OP = 'DELETE' THEN 'delete' ELSE 'upsert' END,
          CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END,
          COALESCE(NULLIF(current_setting('fitron.sync_origin', true), ''), 'cloud'), 'DONE', 0, now());
  RETURN NULL;
END
$$;
CREATE TRIGGER "fitron_sync" AFTER INSERT OR UPDATE OR DELETE ON "Notification" FOR EACH ROW EXECUTE FUNCTION "fitron_sync_Notification"();

CREATE FUNCTION "fitron_sync_MemberDocument"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  r record;
  org text;
BEGIN
  IF COALESCE(current_setting('fitron.allow_delete', true), '') <> '' THEN RETURN NULL; END IF;
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
  IF TG_OP = 'UPDATE' AND (to_jsonb(NEW)) = (to_jsonb(OLD)) THEN RETURN NULL; END IF;
  org := r."orgId";
  IF org IS NULL THEN RETURN NULL; END IF;
  INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "data", "origin", "status", "attempts", "createdAt")
  VALUES (gen_random_uuid()::text, org, 'MemberDocument', r."id", CASE WHEN TG_OP = 'DELETE' THEN 'delete' ELSE 'upsert' END,
          CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END,
          COALESCE(NULLIF(current_setting('fitron.sync_origin', true), ''), 'cloud'), 'DONE', 0, now());
  RETURN NULL;
END
$$;
CREATE TRIGGER "fitron_sync" AFTER INSERT OR UPDATE OR DELETE ON "MemberDocument" FOR EACH ROW EXECUTE FUNCTION "fitron_sync_MemberDocument"();

