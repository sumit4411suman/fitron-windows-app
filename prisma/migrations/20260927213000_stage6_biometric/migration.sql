-- AlterTable
ALTER TABLE "Member" ADD COLUMN     "biometricConsentAt" TIMESTAMPTZ,
ADD COLUMN     "devicePin" TEXT;

-- CreateTable
CREATE TABLE "Device" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "branchId" TEXT,
    "serial" TEXT NOT NULL,
    "model" TEXT,
    "name" TEXT,
    "ip" TEXT,
    "approved" BOOLEAN NOT NULL DEFAULT false,
    "relaySeconds" INTEGER NOT NULL DEFAULT 5,
    "lastSeenAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceCommand" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "cmdNo" INTEGER NOT NULL,
    "command" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "returnCode" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMPTZ,
    "ackAt" TIMESTAMPTZ,

    CONSTRAINT "DeviceCommand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceUser" (
    "deviceId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "allowed" BOOLEAN NOT NULL,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "DeviceUser_pkey" PRIMARY KEY ("deviceId","memberId")
);

-- CreateTable
CREATE TABLE "BiometricTemplate" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "slot" INTEGER NOT NULL,
    "deviceId" TEXT,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BiometricTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccessLog" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "branchId" TEXT,
    "memberId" TEXT,
    "pin" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "reason" TEXT,
    "at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "AccessLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Device_serial_key" ON "Device"("serial");

-- CreateIndex
CREATE INDEX "DeviceCommand_deviceId_status_idx" ON "DeviceCommand"("deviceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceCommand_deviceId_cmdNo_key" ON "DeviceCommand"("deviceId", "cmdNo");

-- CreateIndex
CREATE UNIQUE INDEX "BiometricTemplate_memberId_type_slot_key" ON "BiometricTemplate"("memberId", "type", "slot");

-- CreateIndex
CREATE INDEX "AccessLog_deviceId_at_idx" ON "AccessLog"("deviceId", "at");

-- CreateIndex
CREATE INDEX "AccessLog_memberId_at_idx" ON "AccessLog"("memberId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "Member_orgId_devicePin_key" ON "Member"("orgId", "devicePin");

-- AddForeignKey
ALTER TABLE "DeviceCommand" ADD CONSTRAINT "DeviceCommand_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceUser" ADD CONSTRAINT "DeviceUser_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

