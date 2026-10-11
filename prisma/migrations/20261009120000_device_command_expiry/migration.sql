-- Remote door-open commands expire a few seconds after they are queued, so a device that calls in
-- later does not open the door long after the operator pressed the button. Other commands never expire.

-- AlterTable
ALTER TABLE "DeviceCommand" ADD COLUMN "expiresAt" TIMESTAMPTZ;
