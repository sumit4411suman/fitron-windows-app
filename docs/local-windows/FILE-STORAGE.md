# FITRON Local Windows Edition: file storage (Phase 9)

## Design

```
FileStorage                       src/lib/storage/file-storage.ts
├── S3FileStorage                 Cloud Edition with S3_* set (private bucket)
└── DiskFileStorage               Cloud Edition without S3 (STORAGE_DIR), and the Local Edition
```

`fileStorage()` (`src/lib/storage/index.ts`) picks one per call. The Local Edition always uses the disk under the
customer's data folder, whatever the environment says, so a gym's files never go to a bucket. The app's existing
calls (`putObject`, `getObject`, `deleteObject` in `src/lib/integrations/storage.ts`) are unchanged.

Files are not stored in SQLite. The database holds what a file is and whose it is; storage holds only the bytes:

| File | Metadata in the database | Key in storage |
| --- | --- | --- |
| Member document (ID proof, waiver…) | `MemberDocument`: kind, title, file name, type, size, status, who uploaded | `<orgId>/members/<memberId>/<uuid>.<ext>` |
| Member photo | `Member.photoKey` | `<orgId>/members/<memberId>/photo/<uuid>.<ext>` |
| Staff photo | `User.photoKey` | `<orgId>/staff/<userId>/<uuid>.<ext>` |
| Gym logo | the gym setting's `logoKey` | `<orgId>/gym/logo-<uuid>.<ext>` |
| Backup (Cloud JSON format) | `Backup`: size, SHA-256, counts | `<orgId>/backups/<id>.json` |

Invoices and receipts are not stored: their PDFs are made from the records each time they are opened
(`/invoices/<id>/pdf`), so they can never disagree with the books. Saved copies for printing come with Phase 17.

On a Windows computer this is:

```
%LOCALAPPDATA%\FITRON\documents\<orgId>\members\<memberId>\<uuid>.pdf
```

## Guarantees

- **Whole files only.** A write goes to a temporary file in the same folder, is flushed to disk, and is renamed over
  the target (atomic on NTFS). A power cut leaves the old file or the new one. Leftover temporary files are ignored
  and never listed.
- **Safe names.** Keys are made by the app; any key that could leave the folder (`..`, absolute paths, backslashes)
  or that Windows cannot name (`CON`, `NUL.pdf`, a trailing dot) is refused.
- **Private.** No file is served directly. Every read goes through a signed-in, permission-checked route, and every
  document view is audited.
- **Missing is not an error page.** A file deleted outside FITRON, or a data folder restored without its documents,
  answers 404 and the record stays.
- **Inventory.** `fileInventory(orgId)` (`src/lib/services/file-inventory.ts`) lists every file the gym's records
  point to, and reports missing files and orphans (files no record points to). Orphans are never deleted
  automatically. Backup (Phase 10) uses it to copy exactly the gym's files, and to check a restore.

## Tests

`src/lib/storage/disk-storage.test.ts` (write, read, list, delete, atomic replace, ignored temporary files, refused
keys), `src/lib/storage/s3-storage.test.ts` (bucket listing), `src/lib/services/file-inventory.db.test.ts` (on both
databases), and `e2e/local/documents.spec.ts`. That spec uploads on the member's page, opens the file only when signed
in, finds it in the data folder on Local, and gets 404 after deleting it.
