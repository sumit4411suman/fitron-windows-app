# Fitron ↔ WhatsApp Connector: integration specification

This describes what the Fitron app (backend and dashboard) does with the connector. The Fitron backend is the only
caller; the browser never holds a connector key.

## Keys

| Key | Where it lives | Used for |
| --- | --- | --- |
| `WA_CONNECTOR_MASTER_KEY` | Fitron server env (`WA_CONNECTOR_KEY`) and the connector's `.env` | creating a gym on the connector, rotating its key |
| gym API key (`wak_…`) | sealed in the gym's Fitron settings row (`whatsapp_connector`) | everything else, on behalf of that gym |

Provisioning (`ensureGymKey(orgId)` in `src/lib/integrations/whatsapp.ts`):
1. Read the sealed key from the org's settings; if present, use it.
2. Otherwise `GET /api/v1/gyms/by-external/{orgId}` with the master key. If the gym exists, `POST /api/v1/gyms/{gymId}/rotate-key`
   (the old key was lost). If not, `POST /api/v1/gyms` with `{ name, externalId: orgId, phone }`.
3. Seal and store the returned key. On `INVALID_API_KEY` later, drop the stored key and repeat.

## Dashboard: Settings › WhatsApp

```
WhatsApp Integration
[ Connect WhatsApp ]
```

Click → Fitron backend calls `POST /api/v1/whatsapp/connect` → the dialog shows **"Open WhatsApp › Linked devices › Link a device and scan"**
and subscribes to updates. Fitron polls its own server action every 3 s (the Fitron server reads the connector's
`GET /api/v1/whatsapp/qr` and `GET /api/v1/whatsapp/status`), or — when the dashboard talks to the connector directly
through a server-side proxy — consumes `GET /api/v1/whatsapp/events`:

| SSE event | Dashboard |
| --- | --- |
| `status` `{status: "QR_REQUIRED"}` | show spinner "Preparing QR code…" |
| `qr` `{data: "data:image/png;base64,…", expiresAt}` | render `<img src={data}>`; a new QR replaces it every ~20–60 s |
| `status` `{status: "CONNECTING"}` | "Scanned. Finishing link…" |
| `status` `{status: "CONNECTED", phone: "+91…"}` | close the dialog, mark the gym linked, show the number |
| `status` `{status: "AUTH_FAILURE" \| "SESSION_EXPIRED", error}` | show the error and a **Try again** button (calls connect again) |
| `status` `{status: "DISCONNECTED", error}` | QR expired or the owner cancelled: **Connect** button again |

Connected view:

```
WhatsApp
● Connected                       +91 98765 43210
[Disconnect]  [Reconnect]
Messages today: 24    Failed: 1    Waiting: 3
```

- Numbers come from `GET /api/v1/whatsapp/status` → `data.today.sent`, `data.today.failed`, `data.queued`.
- **Disconnect** → `POST /api/v1/whatsapp/disconnect` (logs the phone out; history stays) then Fitron sets its mode back to demo.
- **Reconnect** → `POST /api/v1/whatsapp/connect` (reuses the saved login; a QR only appears if WhatsApp requires one).
- `RECONNECTING` is shown as "● Reconnecting…" (amber); sends keep queueing meanwhile.

## Sending

Fitron's `sendWhatsApp(mode: "connector", …)` calls `POST /api/v1/messages/send` with `idempotencyKey` = Fitron's own
message id, or `POST /api/v1/messages/document` (multipart) when an invoice PDF is attached. The response is `202` with
`messageId` (same as the key) and status `QUEUED`; Fitron stores "Queued". Its 15-minute dispatcher then calls
`GET /api/v1/messages?ids=a,b,c` and maps `SENT/DELIVERED/READ/FAILED` onto its own statuses.

Errors Fitron surfaces to the gym owner verbatim: `WHATSAPP_NOT_CONNECTED`, `SESSION_EXPIRED` ("scan again"),
`MESSAGE_QUEUE_FULL`, `OPTED_OUT`, `CONSENT_REQUIRED`, `INVALID_PHONE_NUMBER`, `NUMBER_NOT_ON_WHATSAPP`.

Typed automation (optional, when Fitron does not render the text itself): `POST /api/v1/fitron/{membership-expiry |
payment-reminder | payment-receipt | renewal-reminder | welcome | birthday | attendance}`. These render the gym's template on the
connector and are idempotent per member and date, so a daily job can call them without de-duplicating first.

## Consent

When a member is created or edits their profile with "WhatsApp updates: yes", Fitron calls
`POST /api/v1/consent/opt-in {phone, memberId, source: "member-form"}`; unticking calls `opt-out`. Members can also reply
STOP to the gym's number; the connector records that itself and Fitron sees `OPTED_OUT` on the next send.

## Security checklist for the Fitron side

- The master key and gym keys are read on the server only (`import "server-only"`).
- Never forward connector responses that contain `apiKey` to the browser.
- Use HTTPS to the connector (`WA_CONNECTOR_URL=https://wa-api.fitron.in`).
- Time out connector calls (10–15 s) and show the friendly `connectorProblem()` text when it is unreachable.
