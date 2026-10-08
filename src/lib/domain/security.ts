/** Idle sign-out (HANDOFF: default 30 minutes; Setting `security.idleMinutes`, 0 = never). */
export const DEFAULT_IDLE_MINUTES = 30;

/** Whether a session may still be used: ended by its expiry, by idleness, or neither. */
export function sessionAlive(s: { expiresAt: Date; lastSeenAt: Date }, now: number, idleMinutes: number): "ok" | "expired" | "idle" {
  if (s.expiresAt.getTime() < now) return "expired";
  if (idleMinutes > 0 && now - s.lastSeenAt.getTime() > idleMinutes * 60_000) return "idle";
  return "ok";
}
