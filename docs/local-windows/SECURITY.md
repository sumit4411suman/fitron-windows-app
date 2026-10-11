# FITRON Local Windows Edition: security

Grows phase by phase. This version covers local authentication (Phase 8). Shell, IPC, updater and signing are added
in Phases 14, 18, 19 and 25.

## Local authentication (Phase 8)

| Concern | Local Edition behaviour | Where |
| --- | --- | --- |
| Password storage | Argon2id (`@node-rs/argon2`, 19 MiB, 2 passes), the same as the Cloud Edition. No plaintext anywhere; form errors never echo a password back. | `src/lib/auth/password.ts`, `src/app/setup/actions.ts` |
| First account | Created on the computer by first-run setup (`/setup`), only while no user exists; checked again inside the transaction so two windows cannot create two gyms. The page is closed afterwards and answers 404 on the Cloud Edition. | `src/lib/services/local-setup.ts` |
| Sessions | Server-side sessions: the cookie holds a random 256-bit token, the database only its SHA-256. httpOnly, SameSite=Lax, Secure (Chromium treats 127.0.0.1 as a secure origin). 30-minute idle sign-out (configurable), rotation on every sign-in. | `src/lib/auth/session.ts` |
| Roles | Owner = Super Admin, Admin, Accountant, Receptionist, Trainer, and custom roles (Settings › Roles & access). Every page and server action checks the permission on the server. | `src/lib/auth/permissions.ts`, `src/lib/auth/current.ts` |
| Guessing passwords | Per account: 5 wrong passwords in 15 minutes lock that account for the rest of the window, also for unknown emails (no account enumeration). Per address: 30 a minute in Local (one shared computer), 5 a minute in Cloud. | `src/lib/auth/lockout.ts`, `src/app/login/actions.ts` |
| Forgotten owner password | Recovery key shown once at setup: 20 characters from a 32-letter alphabet (100 bits), held only in server memory until shown (never in a cookie, log or the database), stored as an Argon2id hash. Using it sets a new password, signs the owner out everywhere, ends a lockout, is audited, and replaces the key. Same refusal for a wrong key and an unknown email. Rate-limited. | `src/lib/services/local-setup.ts`, `src/app/recover` |
| Forgotten staff password | A Super Admin resets it from Staff (unchanged). | `src/lib/services/staff.ts` |
| Two-step sign-in | Works offline (TOTP). Its secrets are sealed with BIOMETRIC_KEY. | `src/lib/services/two-step.ts` |
| Server keys | BIOMETRIC_KEY, AUTH_SECRET, CRON_SECRET are generated per installation (256-bit random) into `<data>\secrets.json`, written atomically. Phase 19 seals the file with Windows DPAPI. The backup must carry BIOMETRIC_KEY, or two-step secrets are unreadable on a replacement laptop (Phase 10). | `src/lib/runtime/local-secrets.ts` |
| Online sign-in | Google, emailed sign-in links and codes, email password reset and the fitron.in sign-up are not offered and their routes redirect to sign-in. The sign-up service refuses on a Local server. | `src/proxy.ts`, `src/lib/public-paths.ts`, `src/lib/services/accounts.ts` |
| Test-only switch | `FITRON_LOCAL_ALLOW_SIGNUP=1` opens the website sign-up on a Local server so the end-to-end suite can make a gym per test. The desktop shell never sets it (Phase 14 passes an explicit environment). | `src/lib/runtime/edition.ts`, `e2e/env.ts` |

Known limits:

- Lockout counts live in memory, so restarting FITRON clears them. Restarting needs someone at the computer, and the
  recovery key and the Argon2id cost still apply.
- Anyone with the Windows account's files can copy `fitron.db`. Encrypting the database at rest (SQLCipher with a
  DPAPI-held key) is the optional item from the owner's diagram, planned with Phase 19.
