// Every error the API returns has a stable code the Fitron app can act on.

export const ErrorCodes = {
  VALIDATION_ERROR: 400,
  INVALID_PHONE_NUMBER: 400,
  INVALID_TEMPLATE: 400,
  UNSUPPORTED_MEDIA_TYPE: 400,
  FILE_TOO_LARGE: 413,
  UNAUTHORIZED: 401,
  INVALID_API_KEY: 401,
  FORBIDDEN: 403,
  CONSENT_REQUIRED: 403,
  OPTED_OUT: 403,
  GYM_NOT_FOUND: 404,
  NOT_FOUND: 404,
  TEMPLATE_NOT_FOUND: 404,
  MESSAGE_NOT_FOUND: 404,
  GYM_SUSPENDED: 403,
  DUPLICATE_REQUEST: 409,
  CONFLICT: 409,
  WHATSAPP_NOT_CONNECTED: 409,
  QR_EXPIRED: 410,
  SESSION_EXPIRED: 409,
  MESSAGE_QUEUE_FULL: 429,
  RATE_LIMIT_EXCEEDED: 429,
  WHATSAPP_SEND_FAILED: 502,
  NUMBER_NOT_ON_WHATSAPP: 422,
  SERVICE_UNAVAILABLE: 503,
  INTERNAL_ERROR: 500,
} as const;

export type ErrorCode = keyof typeof ErrorCodes;

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = ErrorCodes[code];
    this.details = details;
  }

  toJSON() {
    return { success: false as const, error: { code: this.code, message: this.message, ...(this.details !== undefined ? { details: this.details } : {}) } };
  }
}

export const isAppError = (e: unknown): e is AppError => e instanceof AppError;
