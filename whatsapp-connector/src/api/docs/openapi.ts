// OpenAPI 3.1 document, served at /openapi.json and rendered at /docs. Kept by hand so it stays readable.

const ok = (dataRef?: string, extra: Record<string, unknown> = {}) => ({
  description: "OK",
  content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean", const: true }, ...(dataRef ? { data: { $ref: dataRef } } : { data: { type: "object" } }), ...extra } } } },
});
const err = (description: string) => ({ description, content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } });
const common = { 400: err("Validation error"), 401: err("Missing or invalid API key"), 429: err("Rate limit exceeded") };
const gymKey = [{ gymApiKey: [] }];
const masterKey = [{ masterKey: [] }];
const body = (ref: string, contentType = "application/json") => ({ required: true, content: { [contentType]: { schema: { $ref: ref } } } });

const fitronBase = {
  memberId: { type: "string", example: "MEM123" },
  name: { type: "string", example: "Rahul" },
  phone: { type: "string", example: "+919876543210" },
  idempotencyKey: { type: "string", description: "Optional; derived from the event, member and date when omitted." },
  membershipPlan: { type: "string", example: "Gold Annual" },
  trainerName: { type: "string" },
};
const fitronResponses = { 202: ok("#/components/schemas/Message", { messageId: { type: "string" } }), 200: { ...ok("#/components/schemas/Message"), description: "Already sent for this idempotency key; the original message is returned." }, ...common, 403: err("CONSENT_REQUIRED or OPTED_OUT"), 409: err("WHATSAPP_NOT_CONNECTED or SESSION_EXPIRED") };

export function openApiDocument(publicUrl: string) {
  return {
    openapi: "3.1.0",
    info: {
      title: "Fitron WhatsApp Connector",
      version: "1.0.0",
      description:
        "Self-hosted, multi-tenant WhatsApp Web connector for Fitron. Each gym links its own WhatsApp account by scanning a QR code; Fitron then sends that gym's member communications through it.\n\n" +
        "Authentication: `Authorization: Bearer <gym api key>` for everything a gym does; `Authorization: Bearer <WA_CONNECTOR_MASTER_KEY>` only for the /gyms administration endpoints.\n\n" +
        "Every response is `{ success: true, data }` or `{ success: false, error: { code, message } }`.",
    },
    servers: [{ url: publicUrl }],
    tags: [{ name: "Health" }, { name: "Gyms (admin)" }, { name: "WhatsApp" }, { name: "Messages" }, { name: "Consent" }, { name: "Templates" }, { name: "Fitron events" }],
    components: {
      securitySchemes: { gymApiKey: { type: "http", scheme: "bearer", description: "A gym's API key (wak_…)" }, masterKey: { type: "http", scheme: "bearer", description: "WA_CONNECTOR_MASTER_KEY" } },
      schemas: {
        Error: { type: "object", properties: { success: { type: "boolean", const: false }, error: { type: "object", properties: { code: { type: "string", enum: ["VALIDATION_ERROR", "INVALID_API_KEY", "UNAUTHORIZED", "GYM_NOT_FOUND", "GYM_SUSPENDED", "WHATSAPP_NOT_CONNECTED", "QR_EXPIRED", "SESSION_EXPIRED", "MESSAGE_QUEUE_FULL", "INVALID_PHONE_NUMBER", "NUMBER_NOT_ON_WHATSAPP", "CONSENT_REQUIRED", "OPTED_OUT", "RATE_LIMIT_EXCEEDED", "WHATSAPP_SEND_FAILED", "UNSUPPORTED_MEDIA_TYPE", "FILE_TOO_LARGE", "INVALID_TEMPLATE", "TEMPLATE_NOT_FOUND", "MESSAGE_NOT_FOUND", "DUPLICATE_REQUEST", "CONFLICT", "SERVICE_UNAVAILABLE", "INTERNAL_ERROR"] }, message: { type: "string" }, details: {} } } } },
        SessionStatus: { type: "string", enum: ["DISCONNECTED", "QR_REQUIRED", "CONNECTING", "CONNECTED", "RECONNECTING", "AUTH_FAILURE", "SESSION_EXPIRED"] },
        MessageStatus: { type: "string", enum: ["QUEUED", "PROCESSING", "SENT", "DELIVERED", "READ", "FAILED", "CANCELLED"] },
        Gym: { type: "object", properties: { gymId: { type: "string" }, name: { type: "string" }, externalId: { type: "string", nullable: true }, status: { type: "string", enum: ["ACTIVE", "SUSPENDED", "DELETED"] }, apiKeyPrefix: { type: "string" }, phone: { type: "string", nullable: true }, timezone: { type: "string" }, createdAt: { type: "string", format: "date-time" } } },
        GymCreated: { allOf: [{ $ref: "#/components/schemas/Gym" }, { type: "object", properties: { apiKey: { type: "string", description: "Shown once. Store it; only its hash is kept." } } }] },
        GymCreate: { type: "object", required: ["name"], properties: { name: { type: "string" }, externalId: { type: "string", description: "The gym's id in Fitron" }, phone: { type: "string" }, timezone: { type: "string", default: "Asia/Kolkata" } } },
        Status: { type: "object", properties: { connected: { type: "boolean" }, status: { $ref: "#/components/schemas/SessionStatus" }, phone: { type: "string", nullable: true, example: "+919876543210" }, phoneFormatted: { type: "string", nullable: true }, connectedAt: { type: "string", nullable: true }, error: { type: "string", nullable: true }, workerRunning: { type: "boolean" }, today: { type: "object", properties: { sent: { type: "integer" }, failed: { type: "integer" } } }, queued: { type: "integer" }, usage: { type: "object", properties: { minute: { type: "integer" }, hour: { type: "integer" }, day: { type: "integer" } } }, limits: { type: "object" } } },
        Message: { type: "object", properties: { messageId: { type: "string" }, recipient: { type: "string", example: "919876543210" }, message: { type: "string" }, messageType: { type: "string", enum: ["TEXT", "DOCUMENT", "IMAGE", "PDF"] }, category: { type: "string", enum: ["TRANSACTIONAL", "MARKETING"] }, status: { $ref: "#/components/schemas/MessageStatus" }, memberId: { type: "string", nullable: true }, templateKey: { type: "string", nullable: true }, idempotencyKey: { type: "string", nullable: true }, providerMessageId: { type: "string", nullable: true }, error: { type: "string", nullable: true }, attempts: { type: "integer" }, queuedAt: { type: "string" }, sentAt: { type: "string", nullable: true }, deliveredAt: { type: "string", nullable: true }, readAt: { type: "string", nullable: true }, failedAt: { type: "string", nullable: true }, duplicate: { type: "boolean" } } },
        SendRequest: { type: "object", required: ["to", "message"], properties: { to: { type: "string", example: "+919876543210" }, message: { type: "string", example: "Hello {{name}}, your Fitron membership expires on {{expiryDate}}." }, category: { type: "string", enum: ["TRANSACTIONAL", "MARKETING"], default: "TRANSACTIONAL", description: "MARKETING needs an opt-in on record." }, memberId: { type: "string" }, idempotencyKey: { type: "string" }, variables: { type: "object", additionalProperties: { type: "string" }, description: "Values for {{placeholders}} in message" } } },
        DocumentRequest: { type: "object", required: ["to", "file"], properties: { to: { type: "string" }, caption: { type: "string" }, category: { type: "string", enum: ["TRANSACTIONAL", "MARKETING"] }, memberId: { type: "string" }, idempotencyKey: { type: "string" }, file: { type: "string", format: "binary", description: "PDF, JPEG, PNG, WebP, DOCX, XLSX or CSV up to MAX_MEDIA_BYTES" } } },
        MessageList: { type: "object", properties: { items: { type: "array", items: { $ref: "#/components/schemas/Message" } }, nextCursor: { type: "string", nullable: true } } },
        ConsentRequest: { type: "object", required: ["phone"], properties: { phone: { type: "string" }, memberId: { type: "string" }, source: { type: "string", example: "signup-form" } } },
        Consent: { type: "object", properties: { phoneNumber: { type: "string" }, memberId: { type: "string", nullable: true }, whatsappOptIn: { type: "boolean" }, optInSource: { type: "string", nullable: true }, optInAt: { type: "string", nullable: true }, optOutSource: { type: "string", nullable: true }, optOutAt: { type: "string", nullable: true } } },
        Template: { type: "object", properties: { name: { type: "string" }, body: { type: "string" }, category: { type: "string", enum: ["TRANSACTIONAL", "MARKETING"] }, active: { type: "boolean" }, isDefault: { type: "boolean" } } },
        TemplateUpdate: { type: "object", required: ["body"], properties: { body: { type: "string" }, category: { type: "string", enum: ["TRANSACTIONAL", "MARKETING"] }, active: { type: "boolean" } } },
        MembershipExpiry: { type: "object", required: ["memberId", "name", "phone", "expiryDate"], properties: { ...fitronBase, expiryDate: { type: "string", example: "2026-10-15" } } },
        PaymentReminder: { type: "object", required: ["memberId", "name", "phone", "amount", "dueDate"], properties: { ...fitronBase, amount: { type: "number", example: 1500 }, dueDate: { type: "string", example: "2026-10-10" } } },
        PaymentReceipt: { type: "object", required: ["memberId", "name", "phone", "amount"], properties: { ...fitronBase, amount: { type: "number" }, invoiceNumber: { type: "string" }, date: { type: "string" }, file: { type: "string", format: "binary", description: "The invoice PDF (optional)" } } },
        Welcome: { type: "object", required: ["memberId", "name", "phone"], properties: fitronBase },
        Birthday: { type: "object", required: ["memberId", "name", "phone"], properties: fitronBase },
        Attendance: { type: "object", required: ["memberId", "name", "phone"], properties: { ...fitronBase, date: { type: "string" }, time: { type: "string" } } },
        Health: { type: "object", properties: { status: { type: "string", enum: ["healthy", "degraded", "unhealthy"] }, database: { type: "string" }, redis: { type: "string" }, whatsapp: { type: "string", enum: ["running", "stopped"] } } },
      },
    },
    paths: {
      "/health": { get: { tags: ["Health"], summary: "Liveness and dependency status", responses: { 200: { description: "Healthy", content: { "application/json": { schema: { $ref: "#/components/schemas/Health" } } } }, 503: { description: "Unhealthy" } } } },
      "/ready": { get: { tags: ["Health"], summary: "Readiness (database and Redis reachable)", responses: { 200: { description: "Ready" }, 503: { description: "Not ready" } } } },
      "/api/v1/gyms": {
        post: { tags: ["Gyms (admin)"], security: masterKey, summary: "Create a gym and its API key", requestBody: body("#/components/schemas/GymCreate"), responses: { 201: ok("#/components/schemas/GymCreated"), ...common, 409: err("externalId already exists") } },
        get: { tags: ["Gyms (admin)"], security: masterKey, summary: "List gyms", responses: { 200: ok() } },
      },
      "/api/v1/gyms/me": { get: { tags: ["Gyms (admin)"], security: gymKey, summary: "The gym behind the calling API key", responses: { 200: ok("#/components/schemas/Gym"), 401: common[401] } } },
      "/api/v1/gyms/by-external/{externalId}": { get: { tags: ["Gyms (admin)"], security: masterKey, summary: "Find a gym by its Fitron id", parameters: [{ name: "externalId", in: "path", required: true, schema: { type: "string" } }], responses: { 200: ok("#/components/schemas/Gym"), 404: err("GYM_NOT_FOUND") } } },
      "/api/v1/gyms/{gymId}": {
        get: { tags: ["Gyms (admin)"], security: masterKey, summary: "Get a gym", parameters: [{ name: "gymId", in: "path", required: true, schema: { type: "string" } }], responses: { 200: ok("#/components/schemas/Gym"), 404: err("GYM_NOT_FOUND") } },
        patch: { tags: ["Gyms (admin)"], security: masterKey, summary: "Update name, phone, timezone or status", parameters: [{ name: "gymId", in: "path", required: true, schema: { type: "string" } }], responses: { 200: ok("#/components/schemas/Gym") } },
        delete: { tags: ["Gyms (admin)"], security: masterKey, summary: "Delete a gym (soft; logs WhatsApp out)", parameters: [{ name: "gymId", in: "path", required: true, schema: { type: "string" } }], responses: { 200: ok() } },
      },
      "/api/v1/gyms/{gymId}/rotate-key": { post: { tags: ["Gyms (admin)"], security: masterKey, summary: "Issue a new API key; the old one stops working", parameters: [{ name: "gymId", in: "path", required: true, schema: { type: "string" } }], responses: { 200: ok() } } },
      "/api/v1/whatsapp/connect": { post: { tags: ["WhatsApp"], security: gymKey, summary: "Start linking: a QR code follows on /events", responses: { 200: { description: "OK", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean" }, status: { $ref: "#/components/schemas/SessionStatus", example: "QR_REQUIRED" } } } } } }, 401: common[401], 503: err("Worker not running") } } },
      "/api/v1/whatsapp/status": { get: { tags: ["WhatsApp"], security: gymKey, summary: "Connection state, phone and today's counts", responses: { 200: ok("#/components/schemas/Status", { connected: { type: "boolean" }, status: { $ref: "#/components/schemas/SessionStatus" }, phone: { type: "string", nullable: true } }), 401: common[401] } } },
      "/api/v1/whatsapp/qr": { get: { tags: ["WhatsApp"], security: gymKey, summary: "Current QR code (fallback for clients without SSE)", responses: { 200: ok(), 410: err("QR_EXPIRED") } } },
      "/api/v1/whatsapp/events": { get: { tags: ["WhatsApp"], security: gymKey, summary: "Server-Sent Events: qr, status, message, heartbeat", description: 'Events: `{"type":"qr","data":"data:image/png;base64,…","expiresAt":"…"}`, `{"type":"status","data":{"status":"CONNECTED","phone":"+91…"}}`, `{"type":"message","data":{"messageId":"…","status":"SENT"}}`.', responses: { 200: { description: "text/event-stream" } } } },
      "/api/v1/whatsapp/disconnect": { post: { tags: ["WhatsApp"], security: gymKey, summary: "Log out and delete the saved login (body { logout: false } only closes the socket)", responses: { 200: ok() } } },
      "/api/v1/messages/send": { post: { tags: ["Messages"], security: gymKey, summary: "Queue a text message", requestBody: body("#/components/schemas/SendRequest"), responses: fitronResponses } },
      "/api/v1/messages/document": { post: { tags: ["Messages"], security: gymKey, summary: "Queue a document (multipart: file, to, caption)", requestBody: body("#/components/schemas/DocumentRequest", "multipart/form-data"), responses: { ...fitronResponses, 413: err("FILE_TOO_LARGE") } } },
      "/api/v1/messages/image": { post: { tags: ["Messages"], security: gymKey, summary: "Queue an image (multipart: file, to, caption)", requestBody: body("#/components/schemas/DocumentRequest", "multipart/form-data"), responses: { ...fitronResponses, 413: err("FILE_TOO_LARGE") } } },
      "/api/v1/messages": { get: { tags: ["Messages"], security: gymKey, summary: "List messages", parameters: ["status", "messageType", "recipient", "memberId", "date", "from", "to", "ids", "idempotencyKeys", "limit", "cursor"].map((n) => ({ name: n, in: "query", schema: { type: "string" }, description: n === "ids" ? "Comma-separated message ids (max 200)" : n === "idempotencyKeys" ? "Comma-separated idempotency keys (max 200): look messages up by the caller's own ids" : n === "date" ? "YYYY-MM-DD" : undefined })), responses: { 200: ok("#/components/schemas/MessageList"), 401: common[401] } } },
      "/api/v1/messages/{messageId}": { get: { tags: ["Messages"], security: gymKey, summary: "One message", parameters: [{ name: "messageId", in: "path", required: true, schema: { type: "string" } }], responses: { 200: ok("#/components/schemas/Message"), 404: err("MESSAGE_NOT_FOUND") } } },
      "/api/v1/messages/{messageId}/cancel": { post: { tags: ["Messages"], security: gymKey, summary: "Cancel a queued message", parameters: [{ name: "messageId", in: "path", required: true, schema: { type: "string" } }], responses: { 200: ok("#/components/schemas/Message"), 409: err("Not queued any more") } } },
      "/api/v1/consent/opt-in": { post: { tags: ["Consent"], security: gymKey, summary: "Record an opt-in", requestBody: body("#/components/schemas/ConsentRequest"), responses: { 200: ok("#/components/schemas/Consent"), ...common } } },
      "/api/v1/consent/opt-out": { post: { tags: ["Consent"], security: gymKey, summary: "Record an opt-out", requestBody: body("#/components/schemas/ConsentRequest"), responses: { 200: ok("#/components/schemas/Consent"), ...common } } },
      "/api/v1/consent": { get: { tags: ["Consent"], security: gymKey, summary: "Consent for one phone (?phone=) or a list (?memberId=&optedIn=)", responses: { 200: ok() } } },
      "/api/v1/templates": { get: { tags: ["Templates"], security: gymKey, summary: "The gym's templates and the allowed variables", responses: { 200: ok() } } },
      "/api/v1/templates/preview": { post: { tags: ["Templates"], security: gymKey, summary: "Render a body with variables without sending", responses: { 200: ok() } } },
      "/api/v1/templates/{name}": {
        get: { tags: ["Templates"], security: gymKey, summary: "One template", parameters: [{ name: "name", in: "path", required: true, schema: { type: "string" } }], responses: { 200: ok("#/components/schemas/Template") } },
        put: { tags: ["Templates"], security: gymKey, summary: "Customise a template", parameters: [{ name: "name", in: "path", required: true, schema: { type: "string" } }], requestBody: body("#/components/schemas/TemplateUpdate"), responses: { 200: ok("#/components/schemas/Template"), 400: err("INVALID_TEMPLATE") } },
        delete: { tags: ["Templates"], security: gymKey, summary: "Back to the built-in text", parameters: [{ name: "name", in: "path", required: true, schema: { type: "string" } }], responses: { 200: ok("#/components/schemas/Template") } },
      },
      "/api/v1/fitron/membership-expiry": { post: { tags: ["Fitron events"], security: gymKey, summary: "Membership expiry reminder", requestBody: body("#/components/schemas/MembershipExpiry"), responses: fitronResponses } },
      "/api/v1/fitron/renewal-reminder": { post: { tags: ["Fitron events"], security: gymKey, summary: "Renewal reminder after expiry", requestBody: body("#/components/schemas/MembershipExpiry"), responses: fitronResponses } },
      "/api/v1/fitron/payment-reminder": { post: { tags: ["Fitron events"], security: gymKey, summary: "Payment due reminder", requestBody: body("#/components/schemas/PaymentReminder"), responses: fitronResponses } },
      "/api/v1/fitron/payment-receipt": { post: { tags: ["Fitron events"], security: gymKey, summary: "Payment receipt, optionally with the invoice PDF", requestBody: body("#/components/schemas/PaymentReceipt", "multipart/form-data"), responses: fitronResponses } },
      "/api/v1/fitron/welcome": { post: { tags: ["Fitron events"], security: gymKey, summary: "Welcome a new member", requestBody: body("#/components/schemas/Welcome"), responses: fitronResponses } },
      "/api/v1/fitron/birthday": { post: { tags: ["Fitron events"], security: gymKey, summary: "Birthday wish (marketing: needs opt-in)", requestBody: body("#/components/schemas/Birthday"), responses: fitronResponses } },
      "/api/v1/fitron/attendance": { post: { tags: ["Fitron events"], security: gymKey, summary: "Attendance marked", requestBody: body("#/components/schemas/Attendance"), responses: fitronResponses } },
    },
  };
}
