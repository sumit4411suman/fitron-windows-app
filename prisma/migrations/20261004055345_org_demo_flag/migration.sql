-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "demo" BOOLEAN NOT NULL DEFAULT false;


-- The already-seeded demo gym is marked (the seed could not mark it before this column existed).
UPDATE "Organization" SET "demo" = true WHERE "name" = 'Power Haus Gym (demo)';
