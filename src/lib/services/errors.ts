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
