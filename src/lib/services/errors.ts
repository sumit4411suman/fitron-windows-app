/**
 * A scheduled job that cannot do its work right now because a service it needs is out of reach (no internet on the
 * computer, the WhatsApp connector closed). Not a failure: nothing is recorded, nobody is alerted, and the next run tries
 * again. The message says what it waits for.
 */
export class NotNow extends Error {}

/** A rule the user broke; the message is safe to show them. */
export class UserError extends Error {
  constructor(
    message: string,
    public field?: string,
  ) {
    super(message);
  }
}

export const isUniqueViolation = (e: unknown) =>
  typeof e === "object" && e !== null && "code" in e && (e as { code: string }).code === "P2002";
