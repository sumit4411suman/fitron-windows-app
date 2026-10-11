-- FITRON Local Windows Edition: cloud sync (the SQLite twin of prisma/migrations/20261011200000_cloud_sync). Generated
-- with `prisma migrate diff --from-schema <the previous schema.local.prisma> --to-schema prisma/schema.local.prisma
-- --script`, hand-adjusted where marked "-- fitron:", and the change-capture triggers from
-- `npx tsx scripts/sync-schema.ts --triggers sqlite`. Additive only. Nothing is recorded until the computer is linked.

-- CreateTable
CREATE TABLE "SyncChange" (
    "seq" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, -- fitron: the generator writes BIGINT PRIMARY KEY, which SQLite does not number by itself (as AuditLog.id in 0001_init)
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "SyncDevice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "deviceNo" INTEGER NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "linkedById" TEXT NOT NULL,
    "installationId" TEXT,
    "linkedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME,
    "pulledSeq" BIGINT NOT NULL DEFAULT 0,
    "resyncAt" DATETIME,
    "revokedAt" DATETIME
);

-- CreateTable
CREATE TABLE "SyncApplied" (
    "changeId" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "appliedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "SyncState" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "linked" BOOLEAN NOT NULL DEFAULT false,
    "cloudUrl" TEXT NOT NULL DEFAULT '',
    "orgId" TEXT NOT NULL DEFAULT '',
    "deviceId" TEXT NOT NULL DEFAULT '',
    "deviceNo" INTEGER NOT NULL DEFAULT 0,
    "token" BLOB,
    "linkedEmail" TEXT NOT NULL DEFAULT '',
    "linkedAt" DATETIME,
    "pulledSeq" BIGINT NOT NULL DEFAULT 0,
    "needsSnapshot" BOOLEAN NOT NULL DEFAULT false,
    "lastPushAt" DATETIME,
    "lastPullAt" DATETIME,
    "lastOkAt" DATETIME,
    "lastError" TEXT,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "appliedSeq" BIGINT NOT NULL DEFAULT 0
);

-- CreateTable
CREATE TABLE "SyncVersion" (
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "version" BIGINT NOT NULL,

    PRIMARY KEY ("entity", "entityId")
);

-- CreateTable
CREATE TABLE "SyncConflict" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "ours" JSONB,
    "theirs" JSONB,
    "fields" TEXT NOT NULL DEFAULT '',
    "deviceId" TEXT NOT NULL DEFAULT '',
    "changeId" TEXT NOT NULL DEFAULT '',
    "openedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" DATETIME,
    "resolvedById" TEXT,
    "resolution" TEXT
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


-- fitron: while the sync client applies changes that came from fitron.in it holds a row here (inside its transaction,
-- removed before the commit), so those changes are not recorded as the computer's own and sent back.
CREATE TABLE "_fitron_sync_apply" ("id" INTEGER NOT NULL PRIMARY KEY CHECK ("id" = 1));

-- fitron: change capture.
CREATE TRIGGER "fitron_sync_Branch_insert" AFTER INSERT ON "Branch" FOR EACH ROW
WHEN (SELECT "linked" FROM "SyncState" WHERE "id" = 1) = 1
  AND NOT EXISTS (SELECT 1 FROM "_fitron_sync_apply")
  AND NOT EXISTS (SELECT 1 FROM "_fitron_guard")
BEGIN INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "origin", "status", "attempts", "createdAt")
  VALUES (lower(hex(randomblob(16))), COALESCE(NEW."orgId", ''), 'Branch', NEW."id", 'upsert', 'local', 'PENDING', 0, strftime('%Y-%m-%dT%H:%M:%f', 'now') || '+00:00'); END;

CREATE TRIGGER "fitron_sync_Branch_update" AFTER UPDATE ON "Branch" FOR EACH ROW
WHEN (SELECT "linked" FROM "SyncState" WHERE "id" = 1) = 1
  AND NOT EXISTS (SELECT 1 FROM "_fitron_sync_apply")
  AND NOT EXISTS (SELECT 1 FROM "_fitron_guard")
BEGIN INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "origin", "status", "attempts", "createdAt")
  VALUES (lower(hex(randomblob(16))), COALESCE(NEW."orgId", ''), 'Branch', NEW."id", 'upsert', 'local', 'PENDING', 0, strftime('%Y-%m-%dT%H:%M:%f', 'now') || '+00:00'); END;

CREATE TRIGGER "fitron_sync_Branch_delete" AFTER DELETE ON "Branch" FOR EACH ROW
WHEN (SELECT "linked" FROM "SyncState" WHERE "id" = 1) = 1
  AND NOT EXISTS (SELECT 1 FROM "_fitron_sync_apply")
  AND NOT EXISTS (SELECT 1 FROM "_fitron_guard")
BEGIN INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "origin", "status", "attempts", "createdAt")
  VALUES (lower(hex(randomblob(16))), COALESCE(OLD."orgId", ''), 'Branch', OLD."id", 'delete', 'local', 'PENDING', 0, strftime('%Y-%m-%dT%H:%M:%f', 'now') || '+00:00'); END;

CREATE TRIGGER "fitron_sync_User_insert" AFTER INSERT ON "User" FOR EACH ROW
WHEN (SELECT "linked" FROM "SyncState" WHERE "id" = 1) = 1
  AND NOT EXISTS (SELECT 1 FROM "_fitron_sync_apply")
  AND NOT EXISTS (SELECT 1 FROM "_fitron_guard")
BEGIN INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "origin", "status", "attempts", "createdAt")
  VALUES (lower(hex(randomblob(16))), COALESCE(NEW."orgId", ''), 'User', NEW."id", 'upsert', 'local', 'PENDING', 0, strftime('%Y-%m-%dT%H:%M:%f', 'now') || '+00:00'); END;

CREATE TRIGGER "fitron_sync_User_update" AFTER UPDATE ON "User" FOR EACH ROW
WHEN (SELECT "linked" FROM "SyncState" WHERE "id" = 1) = 1
  AND NOT EXISTS (SELECT 1 FROM "_fitron_sync_apply")
  AND NOT EXISTS (SELECT 1 FROM "_fitron_guard")
  AND (OLD."id" IS NOT NEW."id" OR OLD."orgId" IS NOT NEW."orgId" OR OLD."name" IS NOT NEW."name" OR OLD."email" IS NOT NEW."email" OR OLD."phone" IS NOT NEW."phone" OR OLD."roleId" IS NOT NEW."roleId" OR OLD."ptRate" IS NOT NEW."ptRate" OR OLD."shift" IS NOT NEW."shift" OR OLD."photoKey" IS NOT NEW."photoKey" OR OLD."active" IS NOT NEW."active" OR OLD."salary" IS NOT NEW."salary" OR OLD."joinedOn" IS NOT NEW."joinedOn" OR OLD."payAccount" IS NOT NEW."payAccount" OR OLD."createdAt" IS NOT NEW."createdAt" OR OLD."updatedAt" IS NOT NEW."updatedAt" OR OLD."deletedAt" IS NOT NEW."deletedAt")
BEGIN INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "origin", "status", "attempts", "createdAt")
  VALUES (lower(hex(randomblob(16))), COALESCE(NEW."orgId", ''), 'User', NEW."id", 'upsert', 'local', 'PENDING', 0, strftime('%Y-%m-%dT%H:%M:%f', 'now') || '+00:00'); END;

CREATE TRIGGER "fitron_sync_User_delete" AFTER DELETE ON "User" FOR EACH ROW
WHEN (SELECT "linked" FROM "SyncState" WHERE "id" = 1) = 1
  AND NOT EXISTS (SELECT 1 FROM "_fitron_sync_apply")
  AND NOT EXISTS (SELECT 1 FROM "_fitron_guard")
BEGIN INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "origin", "status", "attempts", "createdAt")
  VALUES (lower(hex(randomblob(16))), COALESCE(OLD."orgId", ''), 'User', OLD."id", 'delete', 'local', 'PENDING', 0, strftime('%Y-%m-%dT%H:%M:%f', 'now') || '+00:00'); END;

CREATE TRIGGER "fitron_sync_UserBranch_insert" AFTER INSERT ON "UserBranch" FOR EACH ROW
WHEN (SELECT "linked" FROM "SyncState" WHERE "id" = 1) = 1
  AND NOT EXISTS (SELECT 1 FROM "_fitron_sync_apply")
  AND NOT EXISTS (SELECT 1 FROM "_fitron_guard")
BEGIN INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "origin", "status", "attempts", "createdAt")
  VALUES (lower(hex(randomblob(16))), COALESCE((SELECT "orgId" FROM "User" WHERE "id" = NEW."userId"), ''), 'UserBranch', NEW."userId" || '|' || NEW."branchId", 'upsert', 'local', 'PENDING', 0, strftime('%Y-%m-%dT%H:%M:%f', 'now') || '+00:00'); END;

CREATE TRIGGER "fitron_sync_UserBranch_update" AFTER UPDATE ON "UserBranch" FOR EACH ROW
WHEN (SELECT "linked" FROM "SyncState" WHERE "id" = 1) = 1
  AND NOT EXISTS (SELECT 1 FROM "_fitron_sync_apply")
  AND NOT EXISTS (SELECT 1 FROM "_fitron_guard")
BEGIN INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "origin", "status", "attempts", "createdAt")
  VALUES (lower(hex(randomblob(16))), COALESCE((SELECT "orgId" FROM "User" WHERE "id" = NEW."userId"), ''), 'UserBranch', NEW."userId" || '|' || NEW."branchId", 'upsert', 'local', 'PENDING', 0, strftime('%Y-%m-%dT%H:%M:%f', 'now') || '+00:00'); END;

CREATE TRIGGER "fitron_sync_UserBranch_delete" AFTER DELETE ON "UserBranch" FOR EACH ROW
WHEN (SELECT "linked" FROM "SyncState" WHERE "id" = 1) = 1
  AND NOT EXISTS (SELECT 1 FROM "_fitron_sync_apply")
  AND NOT EXISTS (SELECT 1 FROM "_fitron_guard")
BEGIN INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "origin", "status", "attempts", "createdAt")
  VALUES (lower(hex(randomblob(16))), COALESCE((SELECT "orgId" FROM "User" WHERE "id" = OLD."userId"), ''), 'UserBranch', OLD."userId" || '|' || OLD."branchId", 'delete', 'local', 'PENDING', 0, strftime('%Y-%m-%dT%H:%M:%f', 'now') || '+00:00'); END;

CREATE TRIGGER "fitron_sync_Setting_insert" AFTER INSERT ON "Setting" FOR EACH ROW
WHEN (SELECT "linked" FROM "SyncState" WHERE "id" = 1) = 1
  AND NOT EXISTS (SELECT 1 FROM "_fitron_sync_apply")
  AND NOT EXISTS (SELECT 1 FROM "_fitron_guard")
  AND NEW."key" NOT IN ('localRecovery', 'whatsapp', 'whatsapp_cloud', 'whatsapp_connector', 'wa_auto_runs', 'updates')
BEGIN INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "origin", "status", "attempts", "createdAt")
  VALUES (lower(hex(randomblob(16))), COALESCE(NEW."orgId", ''), 'Setting', NEW."orgId" || '|' || NEW."key", 'upsert', 'local', 'PENDING', 0, strftime('%Y-%m-%dT%H:%M:%f', 'now') || '+00:00'); END;

CREATE TRIGGER "fitron_sync_Setting_update" AFTER UPDATE ON "Setting" FOR EACH ROW
WHEN (SELECT "linked" FROM "SyncState" WHERE "id" = 1) = 1
  AND NOT EXISTS (SELECT 1 FROM "_fitron_sync_apply")
  AND NOT EXISTS (SELECT 1 FROM "_fitron_guard")
  AND NEW."key" NOT IN ('localRecovery', 'whatsapp', 'whatsapp_cloud', 'whatsapp_connector', 'wa_auto_runs', 'updates')
BEGIN INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "origin", "status", "attempts", "createdAt")
  VALUES (lower(hex(randomblob(16))), COALESCE(NEW."orgId", ''), 'Setting', NEW."orgId" || '|' || NEW."key", 'upsert', 'local', 'PENDING', 0, strftime('%Y-%m-%dT%H:%M:%f', 'now') || '+00:00'); END;

CREATE TRIGGER "fitron_sync_Setting_delete" AFTER DELETE ON "Setting" FOR EACH ROW
WHEN (SELECT "linked" FROM "SyncState" WHERE "id" = 1) = 1
  AND NOT EXISTS (SELECT 1 FROM "_fitron_sync_apply")
  AND NOT EXISTS (SELECT 1 FROM "_fitron_guard")
  AND OLD."key" NOT IN ('localRecovery', 'whatsapp', 'whatsapp_cloud', 'whatsapp_connector', 'wa_auto_runs', 'updates')
BEGIN INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "origin", "status", "attempts", "createdAt")
  VALUES (lower(hex(randomblob(16))), COALESCE(OLD."orgId", ''), 'Setting', OLD."orgId" || '|' || OLD."key", 'delete', 'local', 'PENDING', 0, strftime('%Y-%m-%dT%H:%M:%f', 'now') || '+00:00'); END;

CREATE TRIGGER "fitron_sync_MonthLock_insert" AFTER INSERT ON "MonthLock" FOR EACH ROW
WHEN (SELECT "linked" FROM "SyncState" WHERE "id" = 1) = 1
  AND NOT EXISTS (SELECT 1 FROM "_fitron_sync_apply")
  AND NOT EXISTS (SELECT 1 FROM "_fitron_guard")
BEGIN INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "origin", "status", "attempts", "createdAt")
  VALUES (lower(hex(randomblob(16))), COALESCE((SELECT "orgId" FROM "Branch" WHERE "id" = NEW."branchId"), ''), 'MonthLock', NEW."branchId" || '|' || NEW."month", 'upsert', 'local', 'PENDING', 0, strftime('%Y-%m-%dT%H:%M:%f', 'now') || '+00:00'); END;

CREATE TRIGGER "fitron_sync_MonthLock_update" AFTER UPDATE ON "MonthLock" FOR EACH ROW
WHEN (SELECT "linked" FROM "SyncState" WHERE "id" = 1) = 1
  AND NOT EXISTS (SELECT 1 FROM "_fitron_sync_apply")
  AND NOT EXISTS (SELECT 1 FROM "_fitron_guard")
BEGIN INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "origin", "status", "attempts", "createdAt")
  VALUES (lower(hex(randomblob(16))), COALESCE((SELECT "orgId" FROM "Branch" WHERE "id" = NEW."branchId"), ''), 'MonthLock', NEW."branchId" || '|' || NEW."month", 'upsert', 'local', 'PENDING', 0, strftime('%Y-%m-%dT%H:%M:%f', 'now') || '+00:00'); END;

CREATE TRIGGER "fitron_sync_MonthLock_delete" AFTER DELETE ON "MonthLock" FOR EACH ROW
WHEN (SELECT "linked" FROM "SyncState" WHERE "id" = 1) = 1
  AND NOT EXISTS (SELECT 1 FROM "_fitron_sync_apply")
  AND NOT EXISTS (SELECT 1 FROM "_fitron_guard")
BEGIN INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "origin", "status", "attempts", "createdAt")
  VALUES (lower(hex(randomblob(16))), COALESCE((SELECT "orgId" FROM "Branch" WHERE "id" = OLD."branchId"), ''), 'MonthLock', OLD."branchId" || '|' || OLD."month", 'delete', 'local', 'PENDING', 0, strftime('%Y-%m-%dT%H:%M:%f', 'now') || '+00:00'); END;

CREATE TRIGGER "fitron_sync_MembershipPlan_insert" AFTER INSERT ON "MembershipPlan" FOR EACH ROW
WHEN (SELECT "linked" FROM "SyncState" WHERE "id" = 1) = 1
  AND NOT EXISTS (SELECT 1 FROM "_fitron_sync_apply")
  AND NOT EXISTS (SELECT 1 FROM "_fitron_guard")
BEGIN INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "origin", "status", "attempts", "createdAt")
  VALUES (lower(hex(randomblob(16))), COALESCE(NEW."orgId", ''), 'MembershipPlan', NEW."id", 'upsert', 'local', 'PENDING', 0, strftime('%Y-%m-%dT%H:%M:%f', 'now') || '+00:00'); END;

CREATE TRIGGER "fitron_sync_MembershipPlan_update" AFTER UPDATE ON "MembershipPlan" FOR EACH ROW
WHEN (SELECT "linked" FROM "SyncState" WHERE "id" = 1) = 1
  AND NOT EXISTS (SELECT 1 FROM "_fitron_sync_apply")
  AND NOT EXISTS (SELECT 1 FROM "_fitron_guard")
BEGIN INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "origin", "status", "attempts", "createdAt")
  VALUES (lower(hex(randomblob(16))), COALESCE(NEW."orgId", ''), 'MembershipPlan', NEW."id", 'upsert', 'local', 'PENDING', 0, strftime('%Y-%m-%dT%H:%M:%f', 'now') || '+00:00'); END;

CREATE TRIGGER "fitron_sync_MembershipPlan_delete" AFTER DELETE ON "MembershipPlan" FOR EACH ROW
WHEN (SELECT "linked" FROM "SyncState" WHERE "id" = 1) = 1
  AND NOT EXISTS (SELECT 1 FROM "_fitron_sync_apply")
  AND NOT EXISTS (SELECT 1 FROM "_fitron_guard")
BEGIN INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "origin", "status", "attempts", "createdAt")
  VALUES (lower(hex(randomblob(16))), COALESCE(OLD."orgId", ''), 'MembershipPlan', OLD."id", 'delete', 'local', 'PENDING', 0, strftime('%Y-%m-%dT%H:%M:%f', 'now') || '+00:00'); END;

CREATE TRIGGER "fitron_sync_PlanPrice_insert" AFTER INSERT ON "PlanPrice" FOR EACH ROW
WHEN (SELECT "linked" FROM "SyncState" WHERE "id" = 1) = 1
  AND NOT EXISTS (SELECT 1 FROM "_fitron_sync_apply")
  AND NOT EXISTS (SELECT 1 FROM "_fitron_guard")
BEGIN INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "origin", "status", "attempts", "createdAt")
  VALUES (lower(hex(randomblob(16))), COALESCE((SELECT "orgId" FROM "MembershipPlan" WHERE "id" = NEW."planId"), ''), 'PlanPrice', NEW."planId" || '|' || NEW."category", 'upsert', 'local', 'PENDING', 0, strftime('%Y-%m-%dT%H:%M:%f', 'now') || '+00:00'); END;

CREATE TRIGGER "fitron_sync_PlanPrice_update" AFTER UPDATE ON "PlanPrice" FOR EACH ROW
WHEN (SELECT "linked" FROM "SyncState" WHERE "id" = 1) = 1
  AND NOT EXISTS (SELECT 1 FROM "_fitron_sync_apply")
  AND NOT EXISTS (SELECT 1 FROM "_fitron_guard")
BEGIN INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "origin", "status", "attempts", "createdAt")
  VALUES (lower(hex(randomblob(16))), COALESCE((SELECT "orgId" FROM "MembershipPlan" WHERE "id" = NEW."planId"), ''), 'PlanPrice', NEW."planId" || '|' || NEW."category", 'upsert', 'local', 'PENDING', 0, strftime('%Y-%m-%dT%H:%M:%f', 'now') || '+00:00'); END;

CREATE TRIGGER "fitron_sync_PlanPrice_delete" AFTER DELETE ON "PlanPrice" FOR EACH ROW
WHEN (SELECT "linked" FROM "SyncState" WHERE "id" = 1) = 1
  AND NOT EXISTS (SELECT 1 FROM "_fitron_sync_apply")
  AND NOT EXISTS (SELECT 1 FROM "_fitron_guard")
BEGIN INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "origin", "status", "attempts", "createdAt")
  VALUES (lower(hex(randomblob(16))), COALESCE((SELECT "orgId" FROM "MembershipPlan" WHERE "id" = OLD."planId"), ''), 'PlanPrice', OLD."planId" || '|' || OLD."category", 'delete', 'local', 'PENDING', 0, strftime('%Y-%m-%dT%H:%M:%f', 'now') || '+00:00'); END;

CREATE TRIGGER "fitron_sync_WorkoutPlan_insert" AFTER INSERT ON "WorkoutPlan" FOR EACH ROW
WHEN (SELECT "linked" FROM "SyncState" WHERE "id" = 1) = 1
  AND NOT EXISTS (SELECT 1 FROM "_fitron_sync_apply")
  AND NOT EXISTS (SELECT 1 FROM "_fitron_guard")
BEGIN INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "origin", "status", "attempts", "createdAt")
  VALUES (lower(hex(randomblob(16))), COALESCE(NEW."orgId", ''), 'WorkoutPlan', NEW."id", 'upsert', 'local', 'PENDING', 0, strftime('%Y-%m-%dT%H:%M:%f', 'now') || '+00:00'); END;

CREATE TRIGGER "fitron_sync_WorkoutPlan_update" AFTER UPDATE ON "WorkoutPlan" FOR EACH ROW
WHEN (SELECT "linked" FROM "SyncState" WHERE "id" = 1) = 1
  AND NOT EXISTS (SELECT 1 FROM "_fitron_sync_apply")
  AND NOT EXISTS (SELECT 1 FROM "_fitron_guard")
BEGIN INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "origin", "status", "attempts", "createdAt")
  VALUES (lower(hex(randomblob(16))), COALESCE(NEW."orgId", ''), 'WorkoutPlan', NEW."id", 'upsert', 'local', 'PENDING', 0, strftime('%Y-%m-%dT%H:%M:%f', 'now') || '+00:00'); END;

CREATE TRIGGER "fitron_sync_WorkoutPlan_delete" AFTER DELETE ON "WorkoutPlan" FOR EACH ROW
WHEN (SELECT "linked" FROM "SyncState" WHERE "id" = 1) = 1
  AND NOT EXISTS (SELECT 1 FROM "_fitron_sync_apply")
  AND NOT EXISTS (SELECT 1 FROM "_fitron_guard")
BEGIN INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "origin", "status", "attempts", "createdAt")
  VALUES (lower(hex(randomblob(16))), COALESCE(OLD."orgId", ''), 'WorkoutPlan', OLD."id", 'delete', 'local', 'PENDING', 0, strftime('%Y-%m-%dT%H:%M:%f', 'now') || '+00:00'); END;

CREATE TRIGGER "fitron_sync_DietPlan_insert" AFTER INSERT ON "DietPlan" FOR EACH ROW
WHEN (SELECT "linked" FROM "SyncState" WHERE "id" = 1) = 1
  AND NOT EXISTS (SELECT 1 FROM "_fitron_sync_apply")
  AND NOT EXISTS (SELECT 1 FROM "_fitron_guard")
BEGIN INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "origin", "status", "attempts", "createdAt")
  VALUES (lower(hex(randomblob(16))), COALESCE(NEW."orgId", ''), 'DietPlan', NEW."id", 'upsert', 'local', 'PENDING', 0, strftime('%Y-%m-%dT%H:%M:%f', 'now') || '+00:00'); END;

CREATE TRIGGER "fitron_sync_DietPlan_update" AFTER UPDATE ON "DietPlan" FOR EACH ROW
WHEN (SELECT "linked" FROM "SyncState" WHERE "id" = 1) = 1
  AND NOT EXISTS (SELECT 1 FROM "_fitron_sync_apply")
  AND NOT EXISTS (SELECT 1 FROM "_fitron_guard")
BEGIN INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "origin", "status", "attempts", "createdAt")
  VALUES (lower(hex(randomblob(16))), COALESCE(NEW."orgId", ''), 'DietPlan', NEW."id", 'upsert', 'local', 'PENDING', 0, strftime('%Y-%m-%dT%H:%M:%f', 'now') || '+00:00'); END;

CREATE TRIGGER "fitron_sync_DietPlan_delete" AFTER DELETE ON "DietPlan" FOR EACH ROW
WHEN (SELECT "linked" FROM "SyncState" WHERE "id" = 1) = 1
  AND NOT EXISTS (SELECT 1 FROM "_fitron_sync_apply")
  AND NOT EXISTS (SELECT 1 FROM "_fitron_guard")
BEGIN INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "origin", "status", "attempts", "createdAt")
  VALUES (lower(hex(randomblob(16))), COALESCE(OLD."orgId", ''), 'DietPlan', OLD."id", 'delete', 'local', 'PENDING', 0, strftime('%Y-%m-%dT%H:%M:%f', 'now') || '+00:00'); END;

CREATE TRIGGER "fitron_sync_Member_insert" AFTER INSERT ON "Member" FOR EACH ROW
WHEN (SELECT "linked" FROM "SyncState" WHERE "id" = 1) = 1
  AND NOT EXISTS (SELECT 1 FROM "_fitron_sync_apply")
  AND NOT EXISTS (SELECT 1 FROM "_fitron_guard")
BEGIN INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "origin", "status", "attempts", "createdAt")
  VALUES (lower(hex(randomblob(16))), COALESCE(NEW."orgId", ''), 'Member', NEW."id", 'upsert', 'local', 'PENDING', 0, strftime('%Y-%m-%dT%H:%M:%f', 'now') || '+00:00'); END;

CREATE TRIGGER "fitron_sync_Member_update" AFTER UPDATE ON "Member" FOR EACH ROW
WHEN (SELECT "linked" FROM "SyncState" WHERE "id" = 1) = 1
  AND NOT EXISTS (SELECT 1 FROM "_fitron_sync_apply")
  AND NOT EXISTS (SELECT 1 FROM "_fitron_guard")
BEGIN INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "origin", "status", "attempts", "createdAt")
  VALUES (lower(hex(randomblob(16))), COALESCE(NEW."orgId", ''), 'Member', NEW."id", 'upsert', 'local', 'PENDING', 0, strftime('%Y-%m-%dT%H:%M:%f', 'now') || '+00:00'); END;

CREATE TRIGGER "fitron_sync_Member_delete" AFTER DELETE ON "Member" FOR EACH ROW
WHEN (SELECT "linked" FROM "SyncState" WHERE "id" = 1) = 1
  AND NOT EXISTS (SELECT 1 FROM "_fitron_sync_apply")
  AND NOT EXISTS (SELECT 1 FROM "_fitron_guard")
BEGIN INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "origin", "status", "attempts", "createdAt")
  VALUES (lower(hex(randomblob(16))), COALESCE(OLD."orgId", ''), 'Member', OLD."id", 'delete', 'local', 'PENDING', 0, strftime('%Y-%m-%dT%H:%M:%f', 'now') || '+00:00'); END;

CREATE TRIGGER "fitron_sync_Offer_insert" AFTER INSERT ON "Offer" FOR EACH ROW
WHEN (SELECT "linked" FROM "SyncState" WHERE "id" = 1) = 1
  AND NOT EXISTS (SELECT 1 FROM "_fitron_sync_apply")
  AND NOT EXISTS (SELECT 1 FROM "_fitron_guard")
BEGIN INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "origin", "status", "attempts", "createdAt")
  VALUES (lower(hex(randomblob(16))), COALESCE(NEW."orgId", ''), 'Offer', NEW."id", 'upsert', 'local', 'PENDING', 0, strftime('%Y-%m-%dT%H:%M:%f', 'now') || '+00:00'); END;

CREATE TRIGGER "fitron_sync_Offer_update" AFTER UPDATE ON "Offer" FOR EACH ROW
WHEN (SELECT "linked" FROM "SyncState" WHERE "id" = 1) = 1
  AND NOT EXISTS (SELECT 1 FROM "_fitron_sync_apply")
  AND NOT EXISTS (SELECT 1 FROM "_fitron_guard")
BEGIN INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "origin", "status", "attempts", "createdAt")
  VALUES (lower(hex(randomblob(16))), COALESCE(NEW."orgId", ''), 'Offer', NEW."id", 'upsert', 'local', 'PENDING', 0, strftime('%Y-%m-%dT%H:%M:%f', 'now') || '+00:00'); END;

CREATE TRIGGER "fitron_sync_Offer_delete" AFTER DELETE ON "Offer" FOR EACH ROW
WHEN (SELECT "linked" FROM "SyncState" WHERE "id" = 1) = 1
  AND NOT EXISTS (SELECT 1 FROM "_fitron_sync_apply")
  AND NOT EXISTS (SELECT 1 FROM "_fitron_guard")
BEGIN INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "origin", "status", "attempts", "createdAt")
  VALUES (lower(hex(randomblob(16))), COALESCE(OLD."orgId", ''), 'Offer', OLD."id", 'delete', 'local', 'PENDING', 0, strftime('%Y-%m-%dT%H:%M:%f', 'now') || '+00:00'); END;

CREATE TRIGGER "fitron_sync_Invoice_insert" AFTER INSERT ON "Invoice" FOR EACH ROW
WHEN (SELECT "linked" FROM "SyncState" WHERE "id" = 1) = 1
  AND NOT EXISTS (SELECT 1 FROM "_fitron_sync_apply")
  AND NOT EXISTS (SELECT 1 FROM "_fitron_guard")
BEGIN INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "origin", "status", "attempts", "createdAt")
  VALUES (lower(hex(randomblob(16))), COALESCE(NEW."orgId", ''), 'Invoice', NEW."id", 'upsert', 'local', 'PENDING', 0, strftime('%Y-%m-%dT%H:%M:%f', 'now') || '+00:00'); END;

CREATE TRIGGER "fitron_sync_Invoice_update" AFTER UPDATE ON "Invoice" FOR EACH ROW
WHEN (SELECT "linked" FROM "SyncState" WHERE "id" = 1) = 1
  AND NOT EXISTS (SELECT 1 FROM "_fitron_sync_apply")
  AND NOT EXISTS (SELECT 1 FROM "_fitron_guard")
BEGIN INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "origin", "status", "attempts", "createdAt")
  VALUES (lower(hex(randomblob(16))), COALESCE(NEW."orgId", ''), 'Invoice', NEW."id", 'upsert', 'local', 'PENDING', 0, strftime('%Y-%m-%dT%H:%M:%f', 'now') || '+00:00'); END;

CREATE TRIGGER "fitron_sync_Invoice_delete" AFTER DELETE ON "Invoice" FOR EACH ROW
WHEN (SELECT "linked" FROM "SyncState" WHERE "id" = 1) = 1
  AND NOT EXISTS (SELECT 1 FROM "_fitron_sync_apply")
  AND NOT EXISTS (SELECT 1 FROM "_fitron_guard")
BEGIN INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "origin", "status", "attempts", "createdAt")
  VALUES (lower(hex(randomblob(16))), COALESCE(OLD."orgId", ''), 'Invoice', OLD."id", 'delete', 'local', 'PENDING', 0, strftime('%Y-%m-%dT%H:%M:%f', 'now') || '+00:00'); END;

CREATE TRIGGER "fitron_sync_InvoiceItem_insert" AFTER INSERT ON "InvoiceItem" FOR EACH ROW
WHEN (SELECT "linked" FROM "SyncState" WHERE "id" = 1) = 1
  AND NOT EXISTS (SELECT 1 FROM "_fitron_sync_apply")
  AND NOT EXISTS (SELECT 1 FROM "_fitron_guard")
BEGIN INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "origin", "status", "attempts", "createdAt")
  VALUES (lower(hex(randomblob(16))), COALESCE((SELECT "orgId" FROM "Invoice" WHERE "id" = NEW."invoiceId"), ''), 'InvoiceItem', NEW."id", 'upsert', 'local', 'PENDING', 0, strftime('%Y-%m-%dT%H:%M:%f', 'now') || '+00:00'); END;

CREATE TRIGGER "fitron_sync_InvoiceItem_update" AFTER UPDATE ON "InvoiceItem" FOR EACH ROW
WHEN (SELECT "linked" FROM "SyncState" WHERE "id" = 1) = 1
  AND NOT EXISTS (SELECT 1 FROM "_fitron_sync_apply")
  AND NOT EXISTS (SELECT 1 FROM "_fitron_guard")
BEGIN INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "origin", "status", "attempts", "createdAt")
  VALUES (lower(hex(randomblob(16))), COALESCE((SELECT "orgId" FROM "Invoice" WHERE "id" = NEW."invoiceId"), ''), 'InvoiceItem', NEW."id", 'upsert', 'local', 'PENDING', 0, strftime('%Y-%m-%dT%H:%M:%f', 'now') || '+00:00'); END;

CREATE TRIGGER "fitron_sync_InvoiceItem_delete" AFTER DELETE ON "InvoiceItem" FOR EACH ROW
WHEN (SELECT "linked" FROM "SyncState" WHERE "id" = 1) = 1
  AND NOT EXISTS (SELECT 1 FROM "_fitron_sync_apply")
  AND NOT EXISTS (SELECT 1 FROM "_fitron_guard")
BEGIN INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "origin", "status", "attempts", "createdAt")
  VALUES (lower(hex(randomblob(16))), COALESCE((SELECT "orgId" FROM "Invoice" WHERE "id" = OLD."invoiceId"), ''), 'InvoiceItem', OLD."id", 'delete', 'local', 'PENDING', 0, strftime('%Y-%m-%dT%H:%M:%f', 'now') || '+00:00'); END;

CREATE TRIGGER "fitron_sync_Membership_insert" AFTER INSERT ON "Membership" FOR EACH ROW
WHEN (SELECT "linked" FROM "SyncState" WHERE "id" = 1) = 1
  AND NOT EXISTS (SELECT 1 FROM "_fitron_sync_apply")
  AND NOT EXISTS (SELECT 1 FROM "_fitron_guard")
BEGIN INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "origin", "status", "attempts", "createdAt")
  VALUES (lower(hex(randomblob(16))), COALESCE((SELECT "orgId" FROM "Branch" WHERE "id" = NEW."branchId"), ''), 'Membership', NEW."id", 'upsert', 'local', 'PENDING', 0, strftime('%Y-%m-%dT%H:%M:%f', 'now') || '+00:00'); END;

CREATE TRIGGER "fitron_sync_Membership_update" AFTER UPDATE ON "Membership" FOR EACH ROW
WHEN (SELECT "linked" FROM "SyncState" WHERE "id" = 1) = 1
  AND NOT EXISTS (SELECT 1 FROM "_fitron_sync_apply")
  AND NOT EXISTS (SELECT 1 FROM "_fitron_guard")
BEGIN INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "origin", "status", "attempts", "createdAt")
  VALUES (lower(hex(randomblob(16))), COALESCE((SELECT "orgId" FROM "Branch" WHERE "id" = NEW."branchId"), ''), 'Membership', NEW."id", 'upsert', 'local', 'PENDING', 0, strftime('%Y-%m-%dT%H:%M:%f', 'now') || '+00:00'); END;

CREATE TRIGGER "fitron_sync_Membership_delete" AFTER DELETE ON "Membership" FOR EACH ROW
WHEN (SELECT "linked" FROM "SyncState" WHERE "id" = 1) = 1
  AND NOT EXISTS (SELECT 1 FROM "_fitron_sync_apply")
  AND NOT EXISTS (SELECT 1 FROM "_fitron_guard")
BEGIN INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "origin", "status", "attempts", "createdAt")
  VALUES (lower(hex(randomblob(16))), COALESCE((SELECT "orgId" FROM "Branch" WHERE "id" = OLD."branchId"), ''), 'Membership', OLD."id", 'delete', 'local', 'PENDING', 0, strftime('%Y-%m-%dT%H:%M:%f', 'now') || '+00:00'); END;

CREATE TRIGGER "fitron_sync_Payment_insert" AFTER INSERT ON "Payment" FOR EACH ROW
WHEN (SELECT "linked" FROM "SyncState" WHERE "id" = 1) = 1
  AND NOT EXISTS (SELECT 1 FROM "_fitron_sync_apply")
  AND NOT EXISTS (SELECT 1 FROM "_fitron_guard")
BEGIN INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "origin", "status", "attempts", "createdAt")
  VALUES (lower(hex(randomblob(16))), COALESCE(NEW."orgId", ''), 'Payment', NEW."id", 'upsert', 'local', 'PENDING', 0, strftime('%Y-%m-%dT%H:%M:%f', 'now') || '+00:00'); END;

CREATE TRIGGER "fitron_sync_Payment_update" AFTER UPDATE ON "Payment" FOR EACH ROW
WHEN (SELECT "linked" FROM "SyncState" WHERE "id" = 1) = 1
  AND NOT EXISTS (SELECT 1 FROM "_fitron_sync_apply")
  AND NOT EXISTS (SELECT 1 FROM "_fitron_guard")
BEGIN INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "origin", "status", "attempts", "createdAt")
  VALUES (lower(hex(randomblob(16))), COALESCE(NEW."orgId", ''), 'Payment', NEW."id", 'upsert', 'local', 'PENDING', 0, strftime('%Y-%m-%dT%H:%M:%f', 'now') || '+00:00'); END;

CREATE TRIGGER "fitron_sync_Payment_delete" AFTER DELETE ON "Payment" FOR EACH ROW
WHEN (SELECT "linked" FROM "SyncState" WHERE "id" = 1) = 1
  AND NOT EXISTS (SELECT 1 FROM "_fitron_sync_apply")
  AND NOT EXISTS (SELECT 1 FROM "_fitron_guard")
BEGIN INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "origin", "status", "attempts", "createdAt")
  VALUES (lower(hex(randomblob(16))), COALESCE(OLD."orgId", ''), 'Payment', OLD."id", 'delete', 'local', 'PENDING', 0, strftime('%Y-%m-%dT%H:%M:%f', 'now') || '+00:00'); END;

CREATE TRIGGER "fitron_sync_Purchase_insert" AFTER INSERT ON "Purchase" FOR EACH ROW
WHEN (SELECT "linked" FROM "SyncState" WHERE "id" = 1) = 1
  AND NOT EXISTS (SELECT 1 FROM "_fitron_sync_apply")
  AND NOT EXISTS (SELECT 1 FROM "_fitron_guard")
BEGIN INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "origin", "status", "attempts", "createdAt")
  VALUES (lower(hex(randomblob(16))), COALESCE(NEW."orgId", ''), 'Purchase', NEW."id", 'upsert', 'local', 'PENDING', 0, strftime('%Y-%m-%dT%H:%M:%f', 'now') || '+00:00'); END;

CREATE TRIGGER "fitron_sync_Purchase_update" AFTER UPDATE ON "Purchase" FOR EACH ROW
WHEN (SELECT "linked" FROM "SyncState" WHERE "id" = 1) = 1
  AND NOT EXISTS (SELECT 1 FROM "_fitron_sync_apply")
  AND NOT EXISTS (SELECT 1 FROM "_fitron_guard")
BEGIN INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "origin", "status", "attempts", "createdAt")
  VALUES (lower(hex(randomblob(16))), COALESCE(NEW."orgId", ''), 'Purchase', NEW."id", 'upsert', 'local', 'PENDING', 0, strftime('%Y-%m-%dT%H:%M:%f', 'now') || '+00:00'); END;

CREATE TRIGGER "fitron_sync_Purchase_delete" AFTER DELETE ON "Purchase" FOR EACH ROW
WHEN (SELECT "linked" FROM "SyncState" WHERE "id" = 1) = 1
  AND NOT EXISTS (SELECT 1 FROM "_fitron_sync_apply")
  AND NOT EXISTS (SELECT 1 FROM "_fitron_guard")
BEGIN INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "origin", "status", "attempts", "createdAt")
  VALUES (lower(hex(randomblob(16))), COALESCE(OLD."orgId", ''), 'Purchase', OLD."id", 'delete', 'local', 'PENDING', 0, strftime('%Y-%m-%dT%H:%M:%f', 'now') || '+00:00'); END;

CREATE TRIGGER "fitron_sync_Expense_insert" AFTER INSERT ON "Expense" FOR EACH ROW
WHEN (SELECT "linked" FROM "SyncState" WHERE "id" = 1) = 1
  AND NOT EXISTS (SELECT 1 FROM "_fitron_sync_apply")
  AND NOT EXISTS (SELECT 1 FROM "_fitron_guard")
BEGIN INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "origin", "status", "attempts", "createdAt")
  VALUES (lower(hex(randomblob(16))), COALESCE(NEW."orgId", ''), 'Expense', NEW."id", 'upsert', 'local', 'PENDING', 0, strftime('%Y-%m-%dT%H:%M:%f', 'now') || '+00:00'); END;

CREATE TRIGGER "fitron_sync_Expense_update" AFTER UPDATE ON "Expense" FOR EACH ROW
WHEN (SELECT "linked" FROM "SyncState" WHERE "id" = 1) = 1
  AND NOT EXISTS (SELECT 1 FROM "_fitron_sync_apply")
  AND NOT EXISTS (SELECT 1 FROM "_fitron_guard")
BEGIN INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "origin", "status", "attempts", "createdAt")
  VALUES (lower(hex(randomblob(16))), COALESCE(NEW."orgId", ''), 'Expense', NEW."id", 'upsert', 'local', 'PENDING', 0, strftime('%Y-%m-%dT%H:%M:%f', 'now') || '+00:00'); END;

CREATE TRIGGER "fitron_sync_Expense_delete" AFTER DELETE ON "Expense" FOR EACH ROW
WHEN (SELECT "linked" FROM "SyncState" WHERE "id" = 1) = 1
  AND NOT EXISTS (SELECT 1 FROM "_fitron_sync_apply")
  AND NOT EXISTS (SELECT 1 FROM "_fitron_guard")
BEGIN INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "origin", "status", "attempts", "createdAt")
  VALUES (lower(hex(randomblob(16))), COALESCE(OLD."orgId", ''), 'Expense', OLD."id", 'delete', 'local', 'PENDING', 0, strftime('%Y-%m-%dT%H:%M:%f', 'now') || '+00:00'); END;

CREATE TRIGGER "fitron_sync_PurchaseLine_insert" AFTER INSERT ON "PurchaseLine" FOR EACH ROW
WHEN (SELECT "linked" FROM "SyncState" WHERE "id" = 1) = 1
  AND NOT EXISTS (SELECT 1 FROM "_fitron_sync_apply")
  AND NOT EXISTS (SELECT 1 FROM "_fitron_guard")
BEGIN INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "origin", "status", "attempts", "createdAt")
  VALUES (lower(hex(randomblob(16))), COALESCE((SELECT "orgId" FROM "Purchase" WHERE "id" = NEW."purchaseId"), ''), 'PurchaseLine', NEW."id", 'upsert', 'local', 'PENDING', 0, strftime('%Y-%m-%dT%H:%M:%f', 'now') || '+00:00'); END;

CREATE TRIGGER "fitron_sync_PurchaseLine_update" AFTER UPDATE ON "PurchaseLine" FOR EACH ROW
WHEN (SELECT "linked" FROM "SyncState" WHERE "id" = 1) = 1
  AND NOT EXISTS (SELECT 1 FROM "_fitron_sync_apply")
  AND NOT EXISTS (SELECT 1 FROM "_fitron_guard")
BEGIN INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "origin", "status", "attempts", "createdAt")
  VALUES (lower(hex(randomblob(16))), COALESCE((SELECT "orgId" FROM "Purchase" WHERE "id" = NEW."purchaseId"), ''), 'PurchaseLine', NEW."id", 'upsert', 'local', 'PENDING', 0, strftime('%Y-%m-%dT%H:%M:%f', 'now') || '+00:00'); END;

CREATE TRIGGER "fitron_sync_PurchaseLine_delete" AFTER DELETE ON "PurchaseLine" FOR EACH ROW
WHEN (SELECT "linked" FROM "SyncState" WHERE "id" = 1) = 1
  AND NOT EXISTS (SELECT 1 FROM "_fitron_sync_apply")
  AND NOT EXISTS (SELECT 1 FROM "_fitron_guard")
BEGIN INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "origin", "status", "attempts", "createdAt")
  VALUES (lower(hex(randomblob(16))), COALESCE((SELECT "orgId" FROM "Purchase" WHERE "id" = OLD."purchaseId"), ''), 'PurchaseLine', OLD."id", 'delete', 'local', 'PENDING', 0, strftime('%Y-%m-%dT%H:%M:%f', 'now') || '+00:00'); END;

CREATE TRIGGER "fitron_sync_VendorPayment_insert" AFTER INSERT ON "VendorPayment" FOR EACH ROW
WHEN (SELECT "linked" FROM "SyncState" WHERE "id" = 1) = 1
  AND NOT EXISTS (SELECT 1 FROM "_fitron_sync_apply")
  AND NOT EXISTS (SELECT 1 FROM "_fitron_guard")
BEGIN INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "origin", "status", "attempts", "createdAt")
  VALUES (lower(hex(randomblob(16))), COALESCE((SELECT "orgId" FROM "Purchase" WHERE "id" = NEW."purchaseId"), ''), 'VendorPayment', NEW."id", 'upsert', 'local', 'PENDING', 0, strftime('%Y-%m-%dT%H:%M:%f', 'now') || '+00:00'); END;

CREATE TRIGGER "fitron_sync_VendorPayment_update" AFTER UPDATE ON "VendorPayment" FOR EACH ROW
WHEN (SELECT "linked" FROM "SyncState" WHERE "id" = 1) = 1
  AND NOT EXISTS (SELECT 1 FROM "_fitron_sync_apply")
  AND NOT EXISTS (SELECT 1 FROM "_fitron_guard")
BEGIN INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "origin", "status", "attempts", "createdAt")
  VALUES (lower(hex(randomblob(16))), COALESCE((SELECT "orgId" FROM "Purchase" WHERE "id" = NEW."purchaseId"), ''), 'VendorPayment', NEW."id", 'upsert', 'local', 'PENDING', 0, strftime('%Y-%m-%dT%H:%M:%f', 'now') || '+00:00'); END;

CREATE TRIGGER "fitron_sync_VendorPayment_delete" AFTER DELETE ON "VendorPayment" FOR EACH ROW
WHEN (SELECT "linked" FROM "SyncState" WHERE "id" = 1) = 1
  AND NOT EXISTS (SELECT 1 FROM "_fitron_sync_apply")
  AND NOT EXISTS (SELECT 1 FROM "_fitron_guard")
BEGIN INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "origin", "status", "attempts", "createdAt")
  VALUES (lower(hex(randomblob(16))), COALESCE((SELECT "orgId" FROM "Purchase" WHERE "id" = OLD."purchaseId"), ''), 'VendorPayment', OLD."id", 'delete', 'local', 'PENDING', 0, strftime('%Y-%m-%dT%H:%M:%f', 'now') || '+00:00'); END;

CREATE TRIGGER "fitron_sync_SalaryPayment_insert" AFTER INSERT ON "SalaryPayment" FOR EACH ROW
WHEN (SELECT "linked" FROM "SyncState" WHERE "id" = 1) = 1
  AND NOT EXISTS (SELECT 1 FROM "_fitron_sync_apply")
  AND NOT EXISTS (SELECT 1 FROM "_fitron_guard")
BEGIN INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "origin", "status", "attempts", "createdAt")
  VALUES (lower(hex(randomblob(16))), COALESCE(NEW."orgId", ''), 'SalaryPayment', NEW."id", 'upsert', 'local', 'PENDING', 0, strftime('%Y-%m-%dT%H:%M:%f', 'now') || '+00:00'); END;

CREATE TRIGGER "fitron_sync_SalaryPayment_update" AFTER UPDATE ON "SalaryPayment" FOR EACH ROW
WHEN (SELECT "linked" FROM "SyncState" WHERE "id" = 1) = 1
  AND NOT EXISTS (SELECT 1 FROM "_fitron_sync_apply")
  AND NOT EXISTS (SELECT 1 FROM "_fitron_guard")
BEGIN INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "origin", "status", "attempts", "createdAt")
  VALUES (lower(hex(randomblob(16))), COALESCE(NEW."orgId", ''), 'SalaryPayment', NEW."id", 'upsert', 'local', 'PENDING', 0, strftime('%Y-%m-%dT%H:%M:%f', 'now') || '+00:00'); END;

CREATE TRIGGER "fitron_sync_SalaryPayment_delete" AFTER DELETE ON "SalaryPayment" FOR EACH ROW
WHEN (SELECT "linked" FROM "SyncState" WHERE "id" = 1) = 1
  AND NOT EXISTS (SELECT 1 FROM "_fitron_sync_apply")
  AND NOT EXISTS (SELECT 1 FROM "_fitron_guard")
BEGIN INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "origin", "status", "attempts", "createdAt")
  VALUES (lower(hex(randomblob(16))), COALESCE(OLD."orgId", ''), 'SalaryPayment', OLD."id", 'delete', 'local', 'PENDING', 0, strftime('%Y-%m-%dT%H:%M:%f', 'now') || '+00:00'); END;

CREATE TRIGGER "fitron_sync_Asset_insert" AFTER INSERT ON "Asset" FOR EACH ROW
WHEN (SELECT "linked" FROM "SyncState" WHERE "id" = 1) = 1
  AND NOT EXISTS (SELECT 1 FROM "_fitron_sync_apply")
  AND NOT EXISTS (SELECT 1 FROM "_fitron_guard")
BEGIN INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "origin", "status", "attempts", "createdAt")
  VALUES (lower(hex(randomblob(16))), COALESCE(NEW."orgId", ''), 'Asset', NEW."id", 'upsert', 'local', 'PENDING', 0, strftime('%Y-%m-%dT%H:%M:%f', 'now') || '+00:00'); END;

CREATE TRIGGER "fitron_sync_Asset_update" AFTER UPDATE ON "Asset" FOR EACH ROW
WHEN (SELECT "linked" FROM "SyncState" WHERE "id" = 1) = 1
  AND NOT EXISTS (SELECT 1 FROM "_fitron_sync_apply")
  AND NOT EXISTS (SELECT 1 FROM "_fitron_guard")
BEGIN INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "origin", "status", "attempts", "createdAt")
  VALUES (lower(hex(randomblob(16))), COALESCE(NEW."orgId", ''), 'Asset', NEW."id", 'upsert', 'local', 'PENDING', 0, strftime('%Y-%m-%dT%H:%M:%f', 'now') || '+00:00'); END;

CREATE TRIGGER "fitron_sync_Asset_delete" AFTER DELETE ON "Asset" FOR EACH ROW
WHEN (SELECT "linked" FROM "SyncState" WHERE "id" = 1) = 1
  AND NOT EXISTS (SELECT 1 FROM "_fitron_sync_apply")
  AND NOT EXISTS (SELECT 1 FROM "_fitron_guard")
BEGIN INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "origin", "status", "attempts", "createdAt")
  VALUES (lower(hex(randomblob(16))), COALESCE(OLD."orgId", ''), 'Asset', OLD."id", 'delete', 'local', 'PENDING', 0, strftime('%Y-%m-%dT%H:%M:%f', 'now') || '+00:00'); END;

CREATE TRIGGER "fitron_sync_Product_insert" AFTER INSERT ON "Product" FOR EACH ROW
WHEN (SELECT "linked" FROM "SyncState" WHERE "id" = 1) = 1
  AND NOT EXISTS (SELECT 1 FROM "_fitron_sync_apply")
  AND NOT EXISTS (SELECT 1 FROM "_fitron_guard")
BEGIN INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "origin", "status", "attempts", "createdAt")
  VALUES (lower(hex(randomblob(16))), COALESCE(NEW."orgId", ''), 'Product', NEW."id", 'upsert', 'local', 'PENDING', 0, strftime('%Y-%m-%dT%H:%M:%f', 'now') || '+00:00'); END;

CREATE TRIGGER "fitron_sync_Product_update" AFTER UPDATE ON "Product" FOR EACH ROW
WHEN (SELECT "linked" FROM "SyncState" WHERE "id" = 1) = 1
  AND NOT EXISTS (SELECT 1 FROM "_fitron_sync_apply")
  AND NOT EXISTS (SELECT 1 FROM "_fitron_guard")
BEGIN INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "origin", "status", "attempts", "createdAt")
  VALUES (lower(hex(randomblob(16))), COALESCE(NEW."orgId", ''), 'Product', NEW."id", 'upsert', 'local', 'PENDING', 0, strftime('%Y-%m-%dT%H:%M:%f', 'now') || '+00:00'); END;

CREATE TRIGGER "fitron_sync_Product_delete" AFTER DELETE ON "Product" FOR EACH ROW
WHEN (SELECT "linked" FROM "SyncState" WHERE "id" = 1) = 1
  AND NOT EXISTS (SELECT 1 FROM "_fitron_sync_apply")
  AND NOT EXISTS (SELECT 1 FROM "_fitron_guard")
BEGIN INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "origin", "status", "attempts", "createdAt")
  VALUES (lower(hex(randomblob(16))), COALESCE(OLD."orgId", ''), 'Product', OLD."id", 'delete', 'local', 'PENDING', 0, strftime('%Y-%m-%dT%H:%M:%f', 'now') || '+00:00'); END;

CREATE TRIGGER "fitron_sync_StockMovement_insert" AFTER INSERT ON "StockMovement" FOR EACH ROW
WHEN (SELECT "linked" FROM "SyncState" WHERE "id" = 1) = 1
  AND NOT EXISTS (SELECT 1 FROM "_fitron_sync_apply")
  AND NOT EXISTS (SELECT 1 FROM "_fitron_guard")
BEGIN INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "origin", "status", "attempts", "createdAt")
  VALUES (lower(hex(randomblob(16))), COALESCE((SELECT "orgId" FROM "Product" WHERE "id" = NEW."productId"), ''), 'StockMovement', NEW."id", 'upsert', 'local', 'PENDING', 0, strftime('%Y-%m-%dT%H:%M:%f', 'now') || '+00:00'); END;

CREATE TRIGGER "fitron_sync_StockMovement_update" AFTER UPDATE ON "StockMovement" FOR EACH ROW
WHEN (SELECT "linked" FROM "SyncState" WHERE "id" = 1) = 1
  AND NOT EXISTS (SELECT 1 FROM "_fitron_sync_apply")
  AND NOT EXISTS (SELECT 1 FROM "_fitron_guard")
BEGIN INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "origin", "status", "attempts", "createdAt")
  VALUES (lower(hex(randomblob(16))), COALESCE((SELECT "orgId" FROM "Product" WHERE "id" = NEW."productId"), ''), 'StockMovement', NEW."id", 'upsert', 'local', 'PENDING', 0, strftime('%Y-%m-%dT%H:%M:%f', 'now') || '+00:00'); END;

CREATE TRIGGER "fitron_sync_StockMovement_delete" AFTER DELETE ON "StockMovement" FOR EACH ROW
WHEN (SELECT "linked" FROM "SyncState" WHERE "id" = 1) = 1
  AND NOT EXISTS (SELECT 1 FROM "_fitron_sync_apply")
  AND NOT EXISTS (SELECT 1 FROM "_fitron_guard")
BEGIN INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "origin", "status", "attempts", "createdAt")
  VALUES (lower(hex(randomblob(16))), COALESCE((SELECT "orgId" FROM "Product" WHERE "id" = OLD."productId"), ''), 'StockMovement', OLD."id", 'delete', 'local', 'PENDING', 0, strftime('%Y-%m-%dT%H:%M:%f', 'now') || '+00:00'); END;

CREATE TRIGGER "fitron_sync_Lead_insert" AFTER INSERT ON "Lead" FOR EACH ROW
WHEN (SELECT "linked" FROM "SyncState" WHERE "id" = 1) = 1
  AND NOT EXISTS (SELECT 1 FROM "_fitron_sync_apply")
  AND NOT EXISTS (SELECT 1 FROM "_fitron_guard")
BEGIN INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "origin", "status", "attempts", "createdAt")
  VALUES (lower(hex(randomblob(16))), COALESCE(NEW."orgId", ''), 'Lead', NEW."id", 'upsert', 'local', 'PENDING', 0, strftime('%Y-%m-%dT%H:%M:%f', 'now') || '+00:00'); END;

CREATE TRIGGER "fitron_sync_Lead_update" AFTER UPDATE ON "Lead" FOR EACH ROW
WHEN (SELECT "linked" FROM "SyncState" WHERE "id" = 1) = 1
  AND NOT EXISTS (SELECT 1 FROM "_fitron_sync_apply")
  AND NOT EXISTS (SELECT 1 FROM "_fitron_guard")
BEGIN INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "origin", "status", "attempts", "createdAt")
  VALUES (lower(hex(randomblob(16))), COALESCE(NEW."orgId", ''), 'Lead', NEW."id", 'upsert', 'local', 'PENDING', 0, strftime('%Y-%m-%dT%H:%M:%f', 'now') || '+00:00'); END;

CREATE TRIGGER "fitron_sync_Lead_delete" AFTER DELETE ON "Lead" FOR EACH ROW
WHEN (SELECT "linked" FROM "SyncState" WHERE "id" = 1) = 1
  AND NOT EXISTS (SELECT 1 FROM "_fitron_sync_apply")
  AND NOT EXISTS (SELECT 1 FROM "_fitron_guard")
BEGIN INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "origin", "status", "attempts", "createdAt")
  VALUES (lower(hex(randomblob(16))), COALESCE(OLD."orgId", ''), 'Lead', OLD."id", 'delete', 'local', 'PENDING', 0, strftime('%Y-%m-%dT%H:%M:%f', 'now') || '+00:00'); END;

CREATE TRIGGER "fitron_sync_ClassSlot_insert" AFTER INSERT ON "ClassSlot" FOR EACH ROW
WHEN (SELECT "linked" FROM "SyncState" WHERE "id" = 1) = 1
  AND NOT EXISTS (SELECT 1 FROM "_fitron_sync_apply")
  AND NOT EXISTS (SELECT 1 FROM "_fitron_guard")
BEGIN INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "origin", "status", "attempts", "createdAt")
  VALUES (lower(hex(randomblob(16))), COALESCE(NEW."orgId", ''), 'ClassSlot', NEW."id", 'upsert', 'local', 'PENDING', 0, strftime('%Y-%m-%dT%H:%M:%f', 'now') || '+00:00'); END;

CREATE TRIGGER "fitron_sync_ClassSlot_update" AFTER UPDATE ON "ClassSlot" FOR EACH ROW
WHEN (SELECT "linked" FROM "SyncState" WHERE "id" = 1) = 1
  AND NOT EXISTS (SELECT 1 FROM "_fitron_sync_apply")
  AND NOT EXISTS (SELECT 1 FROM "_fitron_guard")
BEGIN INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "origin", "status", "attempts", "createdAt")
  VALUES (lower(hex(randomblob(16))), COALESCE(NEW."orgId", ''), 'ClassSlot', NEW."id", 'upsert', 'local', 'PENDING', 0, strftime('%Y-%m-%dT%H:%M:%f', 'now') || '+00:00'); END;

CREATE TRIGGER "fitron_sync_ClassSlot_delete" AFTER DELETE ON "ClassSlot" FOR EACH ROW
WHEN (SELECT "linked" FROM "SyncState" WHERE "id" = 1) = 1
  AND NOT EXISTS (SELECT 1 FROM "_fitron_sync_apply")
  AND NOT EXISTS (SELECT 1 FROM "_fitron_guard")
BEGIN INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "origin", "status", "attempts", "createdAt")
  VALUES (lower(hex(randomblob(16))), COALESCE(OLD."orgId", ''), 'ClassSlot', OLD."id", 'delete', 'local', 'PENDING', 0, strftime('%Y-%m-%dT%H:%M:%f', 'now') || '+00:00'); END;

CREATE TRIGGER "fitron_sync_Booking_insert" AFTER INSERT ON "Booking" FOR EACH ROW
WHEN (SELECT "linked" FROM "SyncState" WHERE "id" = 1) = 1
  AND NOT EXISTS (SELECT 1 FROM "_fitron_sync_apply")
  AND NOT EXISTS (SELECT 1 FROM "_fitron_guard")
BEGIN INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "origin", "status", "attempts", "createdAt")
  VALUES (lower(hex(randomblob(16))), COALESCE((SELECT "orgId" FROM "ClassSlot" WHERE "id" = NEW."classSlotId"), ''), 'Booking', NEW."id", 'upsert', 'local', 'PENDING', 0, strftime('%Y-%m-%dT%H:%M:%f', 'now') || '+00:00'); END;

CREATE TRIGGER "fitron_sync_Booking_update" AFTER UPDATE ON "Booking" FOR EACH ROW
WHEN (SELECT "linked" FROM "SyncState" WHERE "id" = 1) = 1
  AND NOT EXISTS (SELECT 1 FROM "_fitron_sync_apply")
  AND NOT EXISTS (SELECT 1 FROM "_fitron_guard")
BEGIN INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "origin", "status", "attempts", "createdAt")
  VALUES (lower(hex(randomblob(16))), COALESCE((SELECT "orgId" FROM "ClassSlot" WHERE "id" = NEW."classSlotId"), ''), 'Booking', NEW."id", 'upsert', 'local', 'PENDING', 0, strftime('%Y-%m-%dT%H:%M:%f', 'now') || '+00:00'); END;

CREATE TRIGGER "fitron_sync_Booking_delete" AFTER DELETE ON "Booking" FOR EACH ROW
WHEN (SELECT "linked" FROM "SyncState" WHERE "id" = 1) = 1
  AND NOT EXISTS (SELECT 1 FROM "_fitron_sync_apply")
  AND NOT EXISTS (SELECT 1 FROM "_fitron_guard")
BEGIN INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "origin", "status", "attempts", "createdAt")
  VALUES (lower(hex(randomblob(16))), COALESCE((SELECT "orgId" FROM "ClassSlot" WHERE "id" = OLD."classSlotId"), ''), 'Booking', OLD."id", 'delete', 'local', 'PENDING', 0, strftime('%Y-%m-%dT%H:%M:%f', 'now') || '+00:00'); END;

CREATE TRIGGER "fitron_sync_Attendance_insert" AFTER INSERT ON "Attendance" FOR EACH ROW
WHEN (SELECT "linked" FROM "SyncState" WHERE "id" = 1) = 1
  AND NOT EXISTS (SELECT 1 FROM "_fitron_sync_apply")
  AND NOT EXISTS (SELECT 1 FROM "_fitron_guard")
BEGIN INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "origin", "status", "attempts", "createdAt")
  VALUES (lower(hex(randomblob(16))), COALESCE((SELECT "orgId" FROM "Branch" WHERE "id" = NEW."branchId"), ''), 'Attendance', NEW."id", 'upsert', 'local', 'PENDING', 0, strftime('%Y-%m-%dT%H:%M:%f', 'now') || '+00:00'); END;

CREATE TRIGGER "fitron_sync_Attendance_update" AFTER UPDATE ON "Attendance" FOR EACH ROW
WHEN (SELECT "linked" FROM "SyncState" WHERE "id" = 1) = 1
  AND NOT EXISTS (SELECT 1 FROM "_fitron_sync_apply")
  AND NOT EXISTS (SELECT 1 FROM "_fitron_guard")
BEGIN INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "origin", "status", "attempts", "createdAt")
  VALUES (lower(hex(randomblob(16))), COALESCE((SELECT "orgId" FROM "Branch" WHERE "id" = NEW."branchId"), ''), 'Attendance', NEW."id", 'upsert', 'local', 'PENDING', 0, strftime('%Y-%m-%dT%H:%M:%f', 'now') || '+00:00'); END;

CREATE TRIGGER "fitron_sync_Attendance_delete" AFTER DELETE ON "Attendance" FOR EACH ROW
WHEN (SELECT "linked" FROM "SyncState" WHERE "id" = 1) = 1
  AND NOT EXISTS (SELECT 1 FROM "_fitron_sync_apply")
  AND NOT EXISTS (SELECT 1 FROM "_fitron_guard")
BEGIN INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "origin", "status", "attempts", "createdAt")
  VALUES (lower(hex(randomblob(16))), COALESCE((SELECT "orgId" FROM "Branch" WHERE "id" = OLD."branchId"), ''), 'Attendance', OLD."id", 'delete', 'local', 'PENDING', 0, strftime('%Y-%m-%dT%H:%M:%f', 'now') || '+00:00'); END;

CREATE TRIGGER "fitron_sync_ProgressLog_insert" AFTER INSERT ON "ProgressLog" FOR EACH ROW
WHEN (SELECT "linked" FROM "SyncState" WHERE "id" = 1) = 1
  AND NOT EXISTS (SELECT 1 FROM "_fitron_sync_apply")
  AND NOT EXISTS (SELECT 1 FROM "_fitron_guard")
BEGIN INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "origin", "status", "attempts", "createdAt")
  VALUES (lower(hex(randomblob(16))), COALESCE((SELECT "orgId" FROM "Member" WHERE "id" = NEW."memberId"), ''), 'ProgressLog', NEW."id", 'upsert', 'local', 'PENDING', 0, strftime('%Y-%m-%dT%H:%M:%f', 'now') || '+00:00'); END;

CREATE TRIGGER "fitron_sync_ProgressLog_update" AFTER UPDATE ON "ProgressLog" FOR EACH ROW
WHEN (SELECT "linked" FROM "SyncState" WHERE "id" = 1) = 1
  AND NOT EXISTS (SELECT 1 FROM "_fitron_sync_apply")
  AND NOT EXISTS (SELECT 1 FROM "_fitron_guard")
BEGIN INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "origin", "status", "attempts", "createdAt")
  VALUES (lower(hex(randomblob(16))), COALESCE((SELECT "orgId" FROM "Member" WHERE "id" = NEW."memberId"), ''), 'ProgressLog', NEW."id", 'upsert', 'local', 'PENDING', 0, strftime('%Y-%m-%dT%H:%M:%f', 'now') || '+00:00'); END;

CREATE TRIGGER "fitron_sync_ProgressLog_delete" AFTER DELETE ON "ProgressLog" FOR EACH ROW
WHEN (SELECT "linked" FROM "SyncState" WHERE "id" = 1) = 1
  AND NOT EXISTS (SELECT 1 FROM "_fitron_sync_apply")
  AND NOT EXISTS (SELECT 1 FROM "_fitron_guard")
BEGIN INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "origin", "status", "attempts", "createdAt")
  VALUES (lower(hex(randomblob(16))), COALESCE((SELECT "orgId" FROM "Member" WHERE "id" = OLD."memberId"), ''), 'ProgressLog', OLD."id", 'delete', 'local', 'PENDING', 0, strftime('%Y-%m-%dT%H:%M:%f', 'now') || '+00:00'); END;

CREATE TRIGGER "fitron_sync_PersonalRecord_insert" AFTER INSERT ON "PersonalRecord" FOR EACH ROW
WHEN (SELECT "linked" FROM "SyncState" WHERE "id" = 1) = 1
  AND NOT EXISTS (SELECT 1 FROM "_fitron_sync_apply")
  AND NOT EXISTS (SELECT 1 FROM "_fitron_guard")
BEGIN INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "origin", "status", "attempts", "createdAt")
  VALUES (lower(hex(randomblob(16))), COALESCE(NEW."orgId", ''), 'PersonalRecord', NEW."id", 'upsert', 'local', 'PENDING', 0, strftime('%Y-%m-%dT%H:%M:%f', 'now') || '+00:00'); END;

CREATE TRIGGER "fitron_sync_PersonalRecord_update" AFTER UPDATE ON "PersonalRecord" FOR EACH ROW
WHEN (SELECT "linked" FROM "SyncState" WHERE "id" = 1) = 1
  AND NOT EXISTS (SELECT 1 FROM "_fitron_sync_apply")
  AND NOT EXISTS (SELECT 1 FROM "_fitron_guard")
BEGIN INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "origin", "status", "attempts", "createdAt")
  VALUES (lower(hex(randomblob(16))), COALESCE(NEW."orgId", ''), 'PersonalRecord', NEW."id", 'upsert', 'local', 'PENDING', 0, strftime('%Y-%m-%dT%H:%M:%f', 'now') || '+00:00'); END;

CREATE TRIGGER "fitron_sync_PersonalRecord_delete" AFTER DELETE ON "PersonalRecord" FOR EACH ROW
WHEN (SELECT "linked" FROM "SyncState" WHERE "id" = 1) = 1
  AND NOT EXISTS (SELECT 1 FROM "_fitron_sync_apply")
  AND NOT EXISTS (SELECT 1 FROM "_fitron_guard")
BEGIN INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "origin", "status", "attempts", "createdAt")
  VALUES (lower(hex(randomblob(16))), COALESCE(OLD."orgId", ''), 'PersonalRecord', OLD."id", 'delete', 'local', 'PENDING', 0, strftime('%Y-%m-%dT%H:%M:%f', 'now') || '+00:00'); END;

CREATE TRIGGER "fitron_sync_MembershipFreeze_insert" AFTER INSERT ON "MembershipFreeze" FOR EACH ROW
WHEN (SELECT "linked" FROM "SyncState" WHERE "id" = 1) = 1
  AND NOT EXISTS (SELECT 1 FROM "_fitron_sync_apply")
  AND NOT EXISTS (SELECT 1 FROM "_fitron_guard")
BEGIN INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "origin", "status", "attempts", "createdAt")
  VALUES (lower(hex(randomblob(16))), COALESCE(NEW."orgId", ''), 'MembershipFreeze', NEW."id", 'upsert', 'local', 'PENDING', 0, strftime('%Y-%m-%dT%H:%M:%f', 'now') || '+00:00'); END;

CREATE TRIGGER "fitron_sync_MembershipFreeze_update" AFTER UPDATE ON "MembershipFreeze" FOR EACH ROW
WHEN (SELECT "linked" FROM "SyncState" WHERE "id" = 1) = 1
  AND NOT EXISTS (SELECT 1 FROM "_fitron_sync_apply")
  AND NOT EXISTS (SELECT 1 FROM "_fitron_guard")
BEGIN INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "origin", "status", "attempts", "createdAt")
  VALUES (lower(hex(randomblob(16))), COALESCE(NEW."orgId", ''), 'MembershipFreeze', NEW."id", 'upsert', 'local', 'PENDING', 0, strftime('%Y-%m-%dT%H:%M:%f', 'now') || '+00:00'); END;

CREATE TRIGGER "fitron_sync_MembershipFreeze_delete" AFTER DELETE ON "MembershipFreeze" FOR EACH ROW
WHEN (SELECT "linked" FROM "SyncState" WHERE "id" = 1) = 1
  AND NOT EXISTS (SELECT 1 FROM "_fitron_sync_apply")
  AND NOT EXISTS (SELECT 1 FROM "_fitron_guard")
BEGIN INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "origin", "status", "attempts", "createdAt")
  VALUES (lower(hex(randomblob(16))), COALESCE(OLD."orgId", ''), 'MembershipFreeze', OLD."id", 'delete', 'local', 'PENDING', 0, strftime('%Y-%m-%dT%H:%M:%f', 'now') || '+00:00'); END;

CREATE TRIGGER "fitron_sync_WhatsAppTemplate_insert" AFTER INSERT ON "WhatsAppTemplate" FOR EACH ROW
WHEN (SELECT "linked" FROM "SyncState" WHERE "id" = 1) = 1
  AND NOT EXISTS (SELECT 1 FROM "_fitron_sync_apply")
  AND NOT EXISTS (SELECT 1 FROM "_fitron_guard")
BEGIN INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "origin", "status", "attempts", "createdAt")
  VALUES (lower(hex(randomblob(16))), COALESCE(NEW."orgId", ''), 'WhatsAppTemplate', NEW."id", 'upsert', 'local', 'PENDING', 0, strftime('%Y-%m-%dT%H:%M:%f', 'now') || '+00:00'); END;

CREATE TRIGGER "fitron_sync_WhatsAppTemplate_update" AFTER UPDATE ON "WhatsAppTemplate" FOR EACH ROW
WHEN (SELECT "linked" FROM "SyncState" WHERE "id" = 1) = 1
  AND NOT EXISTS (SELECT 1 FROM "_fitron_sync_apply")
  AND NOT EXISTS (SELECT 1 FROM "_fitron_guard")
BEGIN INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "origin", "status", "attempts", "createdAt")
  VALUES (lower(hex(randomblob(16))), COALESCE(NEW."orgId", ''), 'WhatsAppTemplate', NEW."id", 'upsert', 'local', 'PENDING', 0, strftime('%Y-%m-%dT%H:%M:%f', 'now') || '+00:00'); END;

CREATE TRIGGER "fitron_sync_WhatsAppTemplate_delete" AFTER DELETE ON "WhatsAppTemplate" FOR EACH ROW
WHEN (SELECT "linked" FROM "SyncState" WHERE "id" = 1) = 1
  AND NOT EXISTS (SELECT 1 FROM "_fitron_sync_apply")
  AND NOT EXISTS (SELECT 1 FROM "_fitron_guard")
BEGIN INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "origin", "status", "attempts", "createdAt")
  VALUES (lower(hex(randomblob(16))), COALESCE(OLD."orgId", ''), 'WhatsAppTemplate', OLD."id", 'delete', 'local', 'PENDING', 0, strftime('%Y-%m-%dT%H:%M:%f', 'now') || '+00:00'); END;

CREATE TRIGGER "fitron_sync_WhatsAppMessage_insert" AFTER INSERT ON "WhatsAppMessage" FOR EACH ROW
WHEN (SELECT "linked" FROM "SyncState" WHERE "id" = 1) = 1
  AND NOT EXISTS (SELECT 1 FROM "_fitron_sync_apply")
  AND NOT EXISTS (SELECT 1 FROM "_fitron_guard")
BEGIN INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "origin", "status", "attempts", "createdAt")
  VALUES (lower(hex(randomblob(16))), COALESCE(NEW."orgId", ''), 'WhatsAppMessage', NEW."id", 'upsert', 'local', 'PENDING', 0, strftime('%Y-%m-%dT%H:%M:%f', 'now') || '+00:00'); END;

CREATE TRIGGER "fitron_sync_WhatsAppMessage_update" AFTER UPDATE ON "WhatsAppMessage" FOR EACH ROW
WHEN (SELECT "linked" FROM "SyncState" WHERE "id" = 1) = 1
  AND NOT EXISTS (SELECT 1 FROM "_fitron_sync_apply")
  AND NOT EXISTS (SELECT 1 FROM "_fitron_guard")
BEGIN INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "origin", "status", "attempts", "createdAt")
  VALUES (lower(hex(randomblob(16))), COALESCE(NEW."orgId", ''), 'WhatsAppMessage', NEW."id", 'upsert', 'local', 'PENDING', 0, strftime('%Y-%m-%dT%H:%M:%f', 'now') || '+00:00'); END;

CREATE TRIGGER "fitron_sync_WhatsAppMessage_delete" AFTER DELETE ON "WhatsAppMessage" FOR EACH ROW
WHEN (SELECT "linked" FROM "SyncState" WHERE "id" = 1) = 1
  AND NOT EXISTS (SELECT 1 FROM "_fitron_sync_apply")
  AND NOT EXISTS (SELECT 1 FROM "_fitron_guard")
BEGIN INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "origin", "status", "attempts", "createdAt")
  VALUES (lower(hex(randomblob(16))), COALESCE(OLD."orgId", ''), 'WhatsAppMessage', OLD."id", 'delete', 'local', 'PENDING', 0, strftime('%Y-%m-%dT%H:%M:%f', 'now') || '+00:00'); END;

CREATE TRIGGER "fitron_sync_AutopayMandate_insert" AFTER INSERT ON "AutopayMandate" FOR EACH ROW
WHEN (SELECT "linked" FROM "SyncState" WHERE "id" = 1) = 1
  AND NOT EXISTS (SELECT 1 FROM "_fitron_sync_apply")
  AND NOT EXISTS (SELECT 1 FROM "_fitron_guard")
BEGIN INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "origin", "status", "attempts", "createdAt")
  VALUES (lower(hex(randomblob(16))), COALESCE(NEW."orgId", ''), 'AutopayMandate', NEW."id", 'upsert', 'local', 'PENDING', 0, strftime('%Y-%m-%dT%H:%M:%f', 'now') || '+00:00'); END;

CREATE TRIGGER "fitron_sync_AutopayMandate_update" AFTER UPDATE ON "AutopayMandate" FOR EACH ROW
WHEN (SELECT "linked" FROM "SyncState" WHERE "id" = 1) = 1
  AND NOT EXISTS (SELECT 1 FROM "_fitron_sync_apply")
  AND NOT EXISTS (SELECT 1 FROM "_fitron_guard")
BEGIN INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "origin", "status", "attempts", "createdAt")
  VALUES (lower(hex(randomblob(16))), COALESCE(NEW."orgId", ''), 'AutopayMandate', NEW."id", 'upsert', 'local', 'PENDING', 0, strftime('%Y-%m-%dT%H:%M:%f', 'now') || '+00:00'); END;

CREATE TRIGGER "fitron_sync_AutopayMandate_delete" AFTER DELETE ON "AutopayMandate" FOR EACH ROW
WHEN (SELECT "linked" FROM "SyncState" WHERE "id" = 1) = 1
  AND NOT EXISTS (SELECT 1 FROM "_fitron_sync_apply")
  AND NOT EXISTS (SELECT 1 FROM "_fitron_guard")
BEGIN INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "origin", "status", "attempts", "createdAt")
  VALUES (lower(hex(randomblob(16))), COALESCE(OLD."orgId", ''), 'AutopayMandate', OLD."id", 'delete', 'local', 'PENDING', 0, strftime('%Y-%m-%dT%H:%M:%f', 'now') || '+00:00'); END;

CREATE TRIGGER "fitron_sync_AutopayEvent_insert" AFTER INSERT ON "AutopayEvent" FOR EACH ROW
WHEN (SELECT "linked" FROM "SyncState" WHERE "id" = 1) = 1
  AND NOT EXISTS (SELECT 1 FROM "_fitron_sync_apply")
  AND NOT EXISTS (SELECT 1 FROM "_fitron_guard")
BEGIN INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "origin", "status", "attempts", "createdAt")
  VALUES (lower(hex(randomblob(16))), COALESCE((SELECT "orgId" FROM "AutopayMandate" WHERE "id" = NEW."mandateId"), ''), 'AutopayEvent', NEW."id", 'upsert', 'local', 'PENDING', 0, strftime('%Y-%m-%dT%H:%M:%f', 'now') || '+00:00'); END;

CREATE TRIGGER "fitron_sync_AutopayEvent_update" AFTER UPDATE ON "AutopayEvent" FOR EACH ROW
WHEN (SELECT "linked" FROM "SyncState" WHERE "id" = 1) = 1
  AND NOT EXISTS (SELECT 1 FROM "_fitron_sync_apply")
  AND NOT EXISTS (SELECT 1 FROM "_fitron_guard")
BEGIN INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "origin", "status", "attempts", "createdAt")
  VALUES (lower(hex(randomblob(16))), COALESCE((SELECT "orgId" FROM "AutopayMandate" WHERE "id" = NEW."mandateId"), ''), 'AutopayEvent', NEW."id", 'upsert', 'local', 'PENDING', 0, strftime('%Y-%m-%dT%H:%M:%f', 'now') || '+00:00'); END;

CREATE TRIGGER "fitron_sync_AutopayEvent_delete" AFTER DELETE ON "AutopayEvent" FOR EACH ROW
WHEN (SELECT "linked" FROM "SyncState" WHERE "id" = 1) = 1
  AND NOT EXISTS (SELECT 1 FROM "_fitron_sync_apply")
  AND NOT EXISTS (SELECT 1 FROM "_fitron_guard")
BEGIN INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "origin", "status", "attempts", "createdAt")
  VALUES (lower(hex(randomblob(16))), COALESCE((SELECT "orgId" FROM "AutopayMandate" WHERE "id" = OLD."mandateId"), ''), 'AutopayEvent', OLD."id", 'delete', 'local', 'PENDING', 0, strftime('%Y-%m-%dT%H:%M:%f', 'now') || '+00:00'); END;

CREATE TRIGGER "fitron_sync_Notification_insert" AFTER INSERT ON "Notification" FOR EACH ROW
WHEN (SELECT "linked" FROM "SyncState" WHERE "id" = 1) = 1
  AND NOT EXISTS (SELECT 1 FROM "_fitron_sync_apply")
  AND NOT EXISTS (SELECT 1 FROM "_fitron_guard")
BEGIN INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "origin", "status", "attempts", "createdAt")
  VALUES (lower(hex(randomblob(16))), COALESCE(NEW."orgId", ''), 'Notification', NEW."id", 'upsert', 'local', 'PENDING', 0, strftime('%Y-%m-%dT%H:%M:%f', 'now') || '+00:00'); END;

CREATE TRIGGER "fitron_sync_Notification_update" AFTER UPDATE ON "Notification" FOR EACH ROW
WHEN (SELECT "linked" FROM "SyncState" WHERE "id" = 1) = 1
  AND NOT EXISTS (SELECT 1 FROM "_fitron_sync_apply")
  AND NOT EXISTS (SELECT 1 FROM "_fitron_guard")
BEGIN INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "origin", "status", "attempts", "createdAt")
  VALUES (lower(hex(randomblob(16))), COALESCE(NEW."orgId", ''), 'Notification', NEW."id", 'upsert', 'local', 'PENDING', 0, strftime('%Y-%m-%dT%H:%M:%f', 'now') || '+00:00'); END;

CREATE TRIGGER "fitron_sync_Notification_delete" AFTER DELETE ON "Notification" FOR EACH ROW
WHEN (SELECT "linked" FROM "SyncState" WHERE "id" = 1) = 1
  AND NOT EXISTS (SELECT 1 FROM "_fitron_sync_apply")
  AND NOT EXISTS (SELECT 1 FROM "_fitron_guard")
BEGIN INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "origin", "status", "attempts", "createdAt")
  VALUES (lower(hex(randomblob(16))), COALESCE(OLD."orgId", ''), 'Notification', OLD."id", 'delete', 'local', 'PENDING', 0, strftime('%Y-%m-%dT%H:%M:%f', 'now') || '+00:00'); END;

CREATE TRIGGER "fitron_sync_MemberDocument_insert" AFTER INSERT ON "MemberDocument" FOR EACH ROW
WHEN (SELECT "linked" FROM "SyncState" WHERE "id" = 1) = 1
  AND NOT EXISTS (SELECT 1 FROM "_fitron_sync_apply")
  AND NOT EXISTS (SELECT 1 FROM "_fitron_guard")
BEGIN INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "origin", "status", "attempts", "createdAt")
  VALUES (lower(hex(randomblob(16))), COALESCE(NEW."orgId", ''), 'MemberDocument', NEW."id", 'upsert', 'local', 'PENDING', 0, strftime('%Y-%m-%dT%H:%M:%f', 'now') || '+00:00'); END;

CREATE TRIGGER "fitron_sync_MemberDocument_update" AFTER UPDATE ON "MemberDocument" FOR EACH ROW
WHEN (SELECT "linked" FROM "SyncState" WHERE "id" = 1) = 1
  AND NOT EXISTS (SELECT 1 FROM "_fitron_sync_apply")
  AND NOT EXISTS (SELECT 1 FROM "_fitron_guard")
BEGIN INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "origin", "status", "attempts", "createdAt")
  VALUES (lower(hex(randomblob(16))), COALESCE(NEW."orgId", ''), 'MemberDocument', NEW."id", 'upsert', 'local', 'PENDING', 0, strftime('%Y-%m-%dT%H:%M:%f', 'now') || '+00:00'); END;

CREATE TRIGGER "fitron_sync_MemberDocument_delete" AFTER DELETE ON "MemberDocument" FOR EACH ROW
WHEN (SELECT "linked" FROM "SyncState" WHERE "id" = 1) = 1
  AND NOT EXISTS (SELECT 1 FROM "_fitron_sync_apply")
  AND NOT EXISTS (SELECT 1 FROM "_fitron_guard")
BEGIN INSERT INTO "SyncChange" ("changeId", "orgId", "entity", "entityId", "op", "origin", "status", "attempts", "createdAt")
  VALUES (lower(hex(randomblob(16))), COALESCE(OLD."orgId", ''), 'MemberDocument', OLD."id", 'delete', 'local', 'PENDING', 0, strftime('%Y-%m-%dT%H:%M:%f', 'now') || '+00:00'); END;

