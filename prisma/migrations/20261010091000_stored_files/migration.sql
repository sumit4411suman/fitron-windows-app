-- Private files kept in the database on a host with no disk and no S3 bucket (Vercel before a bucket is connected),
-- so backups, member photos and documents can still be saved.
CREATE TABLE "StoredFile" (
    "key" TEXT NOT NULL,
    "body" BYTEA NOT NULL,
    "contentType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoredFile_pkey" PRIMARY KEY ("key")
);

ALTER TABLE "StoredFile" ENABLE ROW LEVEL SECURITY;
