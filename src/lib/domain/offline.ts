// The words for a feature that needs the internet when there is none, shared by the server (src/lib/integrations/online.ts)
// and the browser. Gym Accounting itself never needs them: it works on the computer's own database.

export const OFFLINE_MESSAGE = "This feature requires an internet connection.";

/** "Sending WhatsApp messages requires an internet connection. Check the computer's connection…". */
export function offlineMessage(feature?: string, then?: string): string {
  const head = feature ? `${feature} requires an internet connection.` : OFFLINE_MESSAGE;
  return `${head} ${then ?? "Check the computer's connection and try again. Everything else in FITRON keeps working offline."}`;
}
