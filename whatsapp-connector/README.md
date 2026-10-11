# Fitron WhatsApp Connector

A self-hosted, multi-tenant WhatsApp Web connector for the Fitron gym management SaaS. Each gym links its **own** WhatsApp
account by scanning a QR code; Fitron then sends that gym's member communications (welcome messages, expiry and payment
reminders, receipts, attendance notes, birthday wishes) through it.

```
Fitron frontend → Fitron backend → WhatsApp Connector API → WhatsApp Web session (one per gym) → gym's WhatsApp → member
```

It is built for legitimate gym-to-member communication: every message is logged, consent and opt-outs are enforced,
sending is paced per gym, and nothing here bulk-messages, scrapes numbers, joins groups or tries to work around WhatsApp.

**Stack:** Node.js 22 · TypeScript (strict) · Express 5 · PostgreSQL + Prisma · Redis + BullMQ · [Baileys](https://github.com/WhiskeySockets/Baileys)
(WebSocket based, no Chromium) or [whatsapp-web.js](https://github.com/wwebjs/whatsapp-web.js) (headless Chromium), picked with `WA_ENGINE` · Docker · nginx + Let's Encrypt · pino JSON logs.

## Contents

- [How it works](#how-it-works)
- [Quick start (Docker)](#quick-start-docker)
- [Configuration](#configuration)
- [API](#api) — authentication, sessions, messages, consent, templates, Fitron events, health
- [Example requests](#example-requests)
- [Safety controls](#safety-controls)
- [Deployment on an Ubuntu VPS](#deployment-on-an-ubuntu-vps)
- [Operations](#operations) — backups, key rotation, logs, upgrades
- [Development and tests](#development-and-tests)
- [Project structure](#project-structure)

## How it works

Two processes share one image:

| Process | `RUN_MODE` | Job |
| --- | --- | --- |
| **app** (api) | `api` | HTTP API, request validation, consent checks, message log, queueing, Server-Sent Events for QR/status. Stateless; can run more than one. |
| **worker** | `worker` | Owns the WhatsApp sockets (one per gym), consumes the send queue, paces sends per gym, handles STOP/START keywords and delivery receipts. **Exactly one** runs at a time (Redis lock). |

`RUN_MODE=all` runs both in one process for small installs or development.

They talk through Redis: the API publishes commands (connect, disconnect, logout), the worker publishes events (QR image,
status, message updates). Connection state lives in Postgres so either side can read it. WhatsApp authentication data is
written to `SESSION_STORAGE_PATH/<gymId>/`, encrypted with `SESSION_ENCRYPTION_KEY`, so a restart reconnects without a
new scan.

Message flow: `API → validate → consent → queue-size check → log row (QUEUED) → BullMQ job → worker → rate slot → WhatsApp → log (SENT/FAILED) → delivery receipts (DELIVERED/READ)`.

Session states: `DISCONNECTED → QR_REQUIRED → CONNECTING → CONNECTED`, plus `RECONNECTING` (temporary loss, retried with
exponential backoff), `AUTH_FAILURE` (pairing rejected) and `SESSION_EXPIRED` (the phone signed the device out; scan again).

### WhatsApp engine (`WA_ENGINE`)

The connector can hold the gyms' WhatsApp Web sessions with either of two libraries. Gyms see the same thing (scan a QR
code from WhatsApp › Linked devices), and Fitron's API, the queue, pacing, consent and logs are the same for both.

| `WA_ENGINE` | Library | How it works | Memory per linked gym | Login at rest |
| --- | --- | --- | --- | --- |
| `baileys` (`.env.example` and built-in default) | [Baileys](https://github.com/WhiskeySockets/Baileys) | WebSocket, no browser | a few MB | Encrypted files (AES-256-GCM, `SESSION_ENCRYPTION_KEY`) |
| `wwebjs` | [whatsapp-web.js](https://github.com/wwebjs/whatsapp-web.js) | Headless Chromium with WhatsApp Web open, driven by Puppeteer | ~300–500 MB | Chromium profile in `SESSION_STORAGE_PATH/<gymId>/session`, folder mode 0700; **not** encrypted with `SESSION_ENCRYPTION_KEY` (Chromium reads it directly), so protect the volume |

The Docker image includes Chromium for `wwebjs` (`CHROMIUM_PATH=/usr/bin/chromium-browser`). Switching engines does not
carry logins over: every gym scans a new QR code. Both are unofficial WhatsApp Web clients, not the WhatsApp Business
Platform: WhatsApp can change its web app and break them, sessions can drop and need a new scan, and a number that sends
like spam can be restricted.

## Quick start (Docker)

Requirements: a Linux server with Docker and Docker Compose, a domain pointing at it (`wa-api.fitron.in`), ports 80 and 443 open.

```bash
git clone <this repository>
cd fitron/whatsapp-connector
cp .env.example .env
# edit .env: set POSTGRES_PASSWORD, WA_CONNECTOR_MASTER_KEY, SESSION_ENCRYPTION_KEY (openssl rand -hex 32 for each),
#            DOMAIN, LETSENCRYPT_EMAIL, CORS_ORIGIN and PUBLIC_URL

docker compose up -d app worker postgres redis   # builds the image, applies migrations, starts api + worker
sh docker/init-https.sh                          # gets the Let's Encrypt certificate and starts nginx (once)
curl https://wa-api.fitron.in/health
# {"status":"healthy","database":"connected","redis":"connected","whatsapp":"running",...}
```

Postgres and Redis are not published on the host; only nginx listens on 80/443. Sessions, media, database and Redis data
are named volumes (`wa_sessions`, `wa_media`, `pgdata`, `redisdata`), so `docker compose down && docker compose up -d`
keeps every gym linked.

Then create the first gym and connect it: see [Example requests](#example-requests).

## Configuration

All settings are environment variables (`.env`, never committed). The important ones:

| Variable | Default | Meaning |
| --- | --- | --- |
| `WA_CONNECTOR_MASTER_KEY` | — | Admin key for creating gyms and rotating their keys. Server-to-server only; never in a browser. |
| `SESSION_ENCRYPTION_KEY` | — | Encrypts WhatsApp auth data at rest. Changing it invalidates every saved session. |
| `DATABASE_URL`, `REDIS_URL` | — | Set by docker-compose for the containers. |
| `SESSION_STORAGE_PATH` | `/data/whatsapp-sessions` | Persistent volume for sessions. |
| `MEDIA_STORAGE_PATH` | `/data/media` | Files waiting to be sent (deleted once sent). |
| `MAX_MESSAGES_PER_MINUTE` / `_HOUR` / `_DAY` | 10 / 100 / 500 | Per-gym send pacing. |
| `MAX_QUEUE_SIZE_PER_GYM` | 500 | Beyond this the API answers `MESSAGE_QUEUE_FULL`. |
| `MIN_SEND_GAP_MS` / `MAX_SEND_GAP_MS` | 3000 / 8000 | Random pause between two messages from one gym. |
| `MESSAGE_MAX_AGE_HOURS` | 24 | A message that could not go out in this time fails instead of waiting forever. |
| `OPT_OUT_KEYWORDS` / `OPT_IN_KEYWORDS` | STOP,… / START,… | Member replies that change consent. |
| `OPT_OUT_REPLY` | a confirmation text | Sent once after an opt-out (empty = none). |
| `ALLOW_TRANSACTIONAL_AFTER_OPT_OUT` | false | Keep sending receipts/reminders after STOP. Only where that is legal and expected. |
| `REQUIRE_OPT_IN_FOR_TRANSACTIONAL` | false | Require an explicit opt-in record even for transactional messages. |
| `DEFAULT_COUNTRY` | IN | Country for numbers without a country code. |
| `CORS_ORIGIN` | — | Browser origins allowed to call the API directly (comma separated). |
| `API_RATE_LIMIT_PER_MINUTE` | 120 | HTTP requests per API key per minute. |
| `QR_IDLE_MINUTES` | 5 | A QR nobody is watching is abandoned after this. |
| `RECONNECT_GIVE_UP_MINUTES` | 30 | Stop reconnecting after this long offline. |
| `WORKER_CONCURRENCY` | 4 | Parallel sends across gyms. |
| `MAX_MEDIA_BYTES` | 10 MB | Upload limit for documents and images. |

See `.env.example` for the full list with comments.

## API

Base URL: `https://wa-api.fitron.in`. Interactive docs: `/docs` (Swagger UI), raw spec: `/openapi.json`.

Every response is `{ "success": true, "data": … }` or
`{ "success": false, "error": { "code": "WHATSAPP_NOT_CONNECTED", "message": "WhatsApp is not connected." } }`.

Error codes: `VALIDATION_ERROR`, `INVALID_API_KEY`, `UNAUTHORIZED`, `GYM_NOT_FOUND`, `GYM_SUSPENDED`, `WHATSAPP_NOT_CONNECTED`,
`QR_EXPIRED`, `SESSION_EXPIRED`, `MESSAGE_QUEUE_FULL`, `INVALID_PHONE_NUMBER`, `NUMBER_NOT_ON_WHATSAPP`, `CONSENT_REQUIRED`,
`OPTED_OUT`, `RATE_LIMIT_EXCEEDED`, `WHATSAPP_SEND_FAILED`, `UNSUPPORTED_MEDIA_TYPE`, `FILE_TOO_LARGE`, `INVALID_TEMPLATE`,
`TEMPLATE_NOT_FOUND`, `MESSAGE_NOT_FOUND`, `DUPLICATE_REQUEST`, `CONFLICT`, `SERVICE_UNAVAILABLE`, `INTERNAL_ERROR`.

### Authentication

| Header | Who | For |
| --- | --- | --- |
| `Authorization: Bearer <gym api key>` | a gym (via the Fitron backend) | everything under `/api/v1/*` except gym administration |
| `Authorization: Bearer <WA_CONNECTOR_MASTER_KEY>` | the Fitron backend / operator | `/api/v1/gyms*` administration |

Gym keys look like `wak_…`; only their SHA-256 is stored. A key is shown once, at creation or rotation.

### Endpoints

**Gyms (master key)**
`POST /api/v1/gyms` `{name, externalId?, phone?, timezone?}` → `{gymId, apiKey, …}` ·
`GET /api/v1/gyms` · `GET /api/v1/gyms/{gymId}` · `GET /api/v1/gyms/by-external/{externalId}` ·
`PATCH /api/v1/gyms/{gymId}` `{name?, phone?, timezone?, status?}` · `POST /api/v1/gyms/{gymId}/rotate-key` · `DELETE /api/v1/gyms/{gymId}` ·
`GET /api/v1/gyms/me` (gym key: who am I)

**WhatsApp session (gym key)**
`POST /api/v1/whatsapp/connect` → `{success, status: "QR_REQUIRED"}` ·
`GET /api/v1/whatsapp/status` → `{connected, status, phone, data: {today: {sent, failed}, queued, usage, limits, …}}` ·
`GET /api/v1/whatsapp/events` (Server-Sent Events: `status`, `qr`, `message`, `heartbeat`) ·
`GET /api/v1/whatsapp/qr` (one-shot fallback) ·
`POST /api/v1/whatsapp/disconnect` `{logout?: true}` (log out and delete the saved login; `logout:false` only closes the socket)

**Messages (gym key)**
`POST /api/v1/messages/send` `{to, message, category?, memberId?, idempotencyKey?, variables?}` → `202 {messageId}` ·
`POST /api/v1/messages/document` and `/image` (multipart: `file`, `to`, `caption?`, …) ·
`GET /api/v1/messages?status=&messageType=&recipient=&memberId=&date=YYYY-MM-DD&from=&to=&ids=a,b&idempotencyKeys=x,y&limit=&cursor=` ·
`GET /api/v1/messages/{messageId}` · `POST /api/v1/messages/{messageId}/cancel`

Message statuses: `QUEUED → PROCESSING → SENT → DELIVERED → READ`, or `FAILED` / `CANCELLED`.
Types: `TEXT`, `DOCUMENT`, `IMAGE`, `PDF`. Allowed uploads: PDF, JPEG, PNG, WebP, DOCX, XLSX, CSV (content is sniffed; executables are refused).

**Consent (gym key)**
`POST /api/v1/consent/opt-in` `{phone, memberId?, source?}` · `POST /api/v1/consent/opt-out` · `GET /api/v1/consent?phone=` · `GET /api/v1/consent?memberId=&optedIn=`

**Templates (gym key)**
`GET /api/v1/templates` · `GET|PUT|DELETE /api/v1/templates/{name}` · `POST /api/v1/templates/preview`
Variables: `{{name}} {{gymName}} {{expiryDate}} {{dueDate}} {{amount}} {{membershipPlan}} {{trainerName}} {{gymPhone}} {{date}} {{time}} {{memberId}} {{invoiceNumber}}`.
Only plain placeholders are allowed; there is no expression language.

**Fitron events (gym key)** — rendered through the gym's template of the same name, idempotent per member/date:
`POST /api/v1/fitron/membership-expiry` `{memberId, name, phone, expiryDate, membershipPlan?}` ·
`POST /api/v1/fitron/payment-reminder` `{memberId, name, phone, amount, dueDate}` ·
`POST /api/v1/fitron/payment-receipt` (multipart; optional `file` = invoice PDF) ·
`POST /api/v1/fitron/renewal-reminder` · `POST /api/v1/fitron/welcome` · `POST /api/v1/fitron/birthday` (marketing: needs opt-in) · `POST /api/v1/fitron/attendance`

**Health** (no auth): `GET /health` → `{status, database, redis, whatsapp}` · `GET /ready`

## Example requests

```bash
BASE=https://wa-api.fitron.in
MASTER=<WA_CONNECTOR_MASTER_KEY>

# 1. Create a gym (Fitron does this once per gym; store the apiKey — it is not shown again)
curl -s -X POST $BASE/api/v1/gyms -H "Authorization: Bearer $MASTER" -H "Content-Type: application/json" \
  -d '{"name":"Iron Gym Pune","externalId":"org_123","phone":"+912012345678"}'
# {"success":true,"data":{"gymId":"…","apiKey":"wak_…","name":"Iron Gym Pune",…}}
KEY=wak_…

# 2. Start linking: a QR code will arrive on the events stream
curl -s -X POST $BASE/api/v1/whatsapp/connect -H "Authorization: Bearer $KEY"
# {"success":true,"status":"QR_REQUIRED",…}

# 3. Listen for the QR and the status change (Server-Sent Events)
curl -N $BASE/api/v1/whatsapp/events -H "Authorization: Bearer $KEY"
# event: status  data: {"type":"status","data":{"status":"QR_REQUIRED","phone":null}}
# event: qr      data: {"type":"qr","data":"data:image/png;base64,…","expiresAt":"…"}
# event: status  data: {"type":"status","data":{"status":"CONNECTED","phone":"+919876543210"}}

# 4. Check the connection
curl -s $BASE/api/v1/whatsapp/status -H "Authorization: Bearer $KEY"
# {"success":true,"connected":true,"status":"CONNECTED","phone":"+919876543210","data":{…"today":{"sent":24,"failed":1}}}

# 5. Send a test message
curl -s -X POST $BASE/api/v1/messages/send -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"to":"+919876543210","message":"Hello {{name}}, your Fitron membership expires on {{expiryDate}}.","variables":{"name":"Rahul","expiryDate":"15 Oct 2026"},"idempotencyKey":"test-1"}'
# {"success":true,"messageId":"…","data":{"status":"QUEUED",…}}

# 6. See its status
curl -s "$BASE/api/v1/messages?limit=5" -H "Authorization: Bearer $KEY"

# A document (invoice PDF)
curl -s -X POST $BASE/api/v1/messages/document -H "Authorization: Bearer $KEY" \
  -F to=+919876543210 -F caption="Your invoice" -F file=@invoice.pdf

# Fitron events
curl -s -X POST $BASE/api/v1/fitron/membership-expiry -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"memberId":"MEM123","name":"Rahul","phone":"+919876543210","expiryDate":"2026-10-15","membershipPlan":"Gold"}'
curl -s -X POST $BASE/api/v1/fitron/payment-reminder -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"memberId":"MEM123","name":"Rahul","phone":"+919876543210","amount":1500,"dueDate":"2026-10-10"}'
curl -s -X POST $BASE/api/v1/fitron/welcome -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"memberId":"MEM123","name":"Rahul","phone":"+919876543210"}'
curl -s -X POST $BASE/api/v1/fitron/birthday -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"memberId":"MEM123","name":"Rahul","phone":"+919876543210"}'

# Consent
curl -s -X POST $BASE/api/v1/consent/opt-in  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" -d '{"phone":"+919876543210","memberId":"MEM123","source":"signup-form"}'
curl -s -X POST $BASE/api/v1/consent/opt-out -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" -d '{"phone":"+919876543210"}'

# Disconnect (logs out; message history and consent records stay)
curl -s -X POST $BASE/api/v1/whatsapp/disconnect -H "Authorization: Bearer $KEY"
```

Phone numbers: `+919876543210`, `919876543210` and `9876543210` all normalise to `919876543210` (India is the default
country); numbers with a `+` or `00` prefix are parsed as written, so `+447911123456` stays British. Invalid numbers get
`INVALID_PHONE_NUMBER`; numbers that are not on WhatsApp fail with `NUMBER_NOT_ON_WHATSAPP` when sent.

## Safety controls

- **Consent.** `MARKETING` messages (birthday wishes, offers) need an opt-in on record. `TRANSACTIONAL` messages (welcome,
  expiry, payment reminders, receipts, attendance) go to anyone who has not opted out. After a member replies STOP /
  UNSUBSCRIBE / CANCEL, nothing more is sent to them (unless the operator explicitly enables
  `ALLOW_TRANSACTIONAL_AFTER_OPT_OUT` for legally required notices). START / SUBSCRIBE opts back in. Consent is per gym.
- **Pacing.** Per-gym minute/hour/day limits plus a random 3–8 s gap between messages, enforced in the worker through
  Redis. The queue absorbs bursts up to `MAX_QUEUE_SIZE_PER_GYM`; beyond that the API refuses. Retries use exponential
  backoff (30 s → 8 min, 6 attempts). Messages older than `MESSAGE_MAX_AGE_HOURS` fail instead of surprising a member days later.
- **Idempotency.** `idempotencyKey` (per gym) and the BullMQ job id (= message id) prevent double sends; Fitron events derive a key from event + member + date when none is given.
- **Isolation.** Every row carries `gymId`; every query is scoped by the authenticated gym; sessions live in separate encrypted folders; a gym's SSE stream only ever carries its own events. Tests assert that gym A cannot read gym B's session, QR, messages, consent or templates.
- **Secrets.** API keys are stored hashed; WhatsApp auth files are encrypted at rest; logs redact keys, QR payloads and message bodies; no endpoint returns authentication data.
- **Not included, by design:** bulk/unsolicited messaging, number scraping, group joining or member scraping, anti-ban or CAPTCHA bypass, account creation, session sharing between gyms.

## Running on a gym computer (Windows, no server)

A Windows PC that stays switched on can run the connector instead of a server. Tailscale Funnel (free, no card, no
domain changes) gives it a fixed public `https://<pc>.<tailnet>.ts.net` address, so nothing is opened on the router.

1. Install [Docker Desktop](https://www.docker.com/products/docker-desktop/) and open it until it says *Engine running*.
   In its Settings › General tick *Start Docker Desktop when you sign in*.
2. Download this repository (GitHub › Code › Download ZIP), unzip it, open the `whatsapp-connector` folder, then in that
   folder's address bar type `powershell` and run `powershell -ExecutionPolicy Bypass -File install-windows.ps1`.
   It writes `.env` with new secrets, builds and starts the connector on `127.0.0.1:3000` only
   (`docker-compose.local.yml`; no nginx or certbot), waits for `/health` and prints the master key.
3. Install [Tailscale](https://tailscale.com/download/windows), sign in, and run `tailscale funnel --bg 3000`
   (the first run prints a link to switch Funnel on for the tailnet). It prints the public address and keeps serving it
   after restarts.
4. In Fitron's environment set `WA_CONNECTOR_URL` to that address and `WA_CONNECTOR_KEY` to the printed key; redeploy.

Keep the PC from sleeping (Settings › System › Power › Sleep: Never) and on the internet: while it is off, Fitron cannot reach the
connector, so sends are marked Failed with an alert (retry them from WhatsApp › Failed once the PC is back). Back up `.env` (it holds `SESSION_ENCRYPTION_KEY`).

## Deployment on an Ubuntu VPS

```
Internet → https://wa-api.fitron.in → nginx (TLS, rate limit) → app:3000 → Postgres / Redis → worker → WhatsApp sessions
```

**One command:** on the server, `git clone` this repository and run `bash whatsapp-connector/install.sh`. It installs Docker,
opens ports 80/443, asks for the domain and email, generates every secret into `.env`, starts the connector, gets the HTTPS
certificate and prints the `WA_CONNECTOR_URL` and `WA_CONNECTOR_KEY` to put in Vercel. The manual steps it automates:

1. Ubuntu 22.04/24.04, 2 vCPU, 2 GB RAM is plenty for dozens of gyms (each Baileys session is a WebSocket, not a browser).
2. `apt install docker.io docker-compose-v2`, point `wa-api.fitron.in` (A record) at the server, open ports 80 and 443.
3. Clone, `cp .env.example .env`, fill in the secrets (`openssl rand -hex 32`), `DOMAIN=wa-api.fitron.in`, `LETSENCRYPT_EMAIL`, `CORS_ORIGIN=https://www.fitron.in`, `PUBLIC_URL=https://wa-api.fitron.in`.
4. `docker compose up -d app worker postgres redis`, then `sh docker/init-https.sh` once. Certificates renew automatically (certbot container).
5. Put `WA_CONNECTOR_URL=https://wa-api.fitron.in` and `WA_CONNECTOR_KEY=<master key>` in the Fitron app's environment. Fitron creates a gym on the connector the first time a gym owner presses **Link WhatsApp** and stores that gym's own key.
6. Monitoring: `GET /health` (503 when Postgres/Redis are down, `whatsapp: "stopped"` when no worker holds the lock). Logs are JSON on stdout: `docker compose logs -f app worker`.

Updating: `git pull && docker compose build && docker compose up -d` — migrations run on app start; sessions persist in their volume.

## Operations

- **Rotate a gym key:** `POST /api/v1/gyms/{gymId}/rotate-key` with the master key; update Fitron's stored key. Fitron does this automatically when it gets `INVALID_API_KEY` for a gym it created.
- **A gym changed phones / got signed out:** status becomes `SESSION_EXPIRED`; the owner presses Connect and scans again. Messages queued meanwhile wait up to `MESSAGE_MAX_AGE_HOURS`.
- **Backups:** `docker compose exec postgres pg_dump -U wa wa_connector > wa.sql` plus the `wa_sessions` volume (encrypted; useless without `SESSION_ENCRYPTION_KEY`). Media is transient.
- **Scaling:** `app` can run with several replicas behind nginx; `worker` must stay at one replica (a second one waits on the Redis lock and takes over if the first dies).
- **Logs:** `LOG_LEVEL=debug` for more; never contain keys, QR payloads or message bodies.

## Development and tests

```bash
npm install                     # also generates the Prisma client
cp .env.example .env            # point DATABASE_URL/REDIS_URL at local services, RUN_MODE=all
npm run db:migrate              # creates the schema (dev) — or npm run db:deploy
npm run dev                     # tsx watch, pretty logs

npm run lint && npm run typecheck
npm test                        # unit + API tests: no Postgres, Redis or WhatsApp needed (in-memory fakes, mock provider)
npm run test:integration        # real Postgres + Redis + BullMQ, mock WhatsApp: the full "definition of done" flow
```

Integration tests expect `DATABASE_URL` (default `postgresql://postgres:postgres@127.0.0.1:5440/wa_test`) and `REDIS_URL`
(default `redis://127.0.0.1:6390`) and apply the migration with `npx prisma migrate deploy` first. CI
(`.github/workflows/whatsapp-connector.yml`) runs lint, typecheck, build, both test suites and a Docker build.

The WhatsApp library sits behind `src/whatsapp/provider.ts`; `tests/helpers/mockProvider.ts` implements the same
interface so no test needs a real account.

## Project structure

```
whatsapp-connector/
├── src/
│   ├── config/        env.ts (validated settings), database.ts (Prisma), redis.ts
│   ├── server/        app.ts (Express), server.ts (entry, shutdown), container.ts (wiring), worker.ts
│   ├── whatsapp/      WhatsAppManager (sessions owner, lock, commands), WhatsAppSession (state machine, reconnects),
│   │                  BaileysProvider + provider.ts (library boundary), authState.ts (encrypted auth store),
│   │                  QRManager, SessionGateway (API side), MessageService, MediaService, events.ts (Redis pub/sub)
│   ├── api/           auth/ (gyms), whatsapp/, messages/, consent/, templates/, fitron/, health/, docs/ (OpenAPI)
│   ├── middleware/    apiKeyAuth, rateLimiter, errorHandler, requestLogger, validate
│   ├── queue/         messageQueue (BullMQ), processor (one job = one message), messageWorker
│   ├── services/      GymService, ConsentService, MessageLogService, TemplateService, RateLimitService
│   ├── database/prisma/  schema.prisma + migrations/
│   ├── utils/         phoneNumber, encryption, apiKey, errors, logger
│   └── types/
├── tests/             unit/ (fakes + mock provider), integration/ (real Postgres/Redis), helpers/
├── docker/            nginx templates, entrypoint, init-https.sh
├── Dockerfile, docker-compose.yml, .env.example
└── docs/FRONTEND-INTEGRATION.md
```
