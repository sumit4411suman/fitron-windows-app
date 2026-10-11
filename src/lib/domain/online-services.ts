// Settings › Integrations & AI on FITRON for Windows: every online service the app can use, whether it is on, and what
// it would send and to whom. Gym data leaves the computer only through a service a gym user turned on here or where
// the row says; nothing is on by itself.

export type OnlineServicesState = {
  whatsapp: { mode: "demo" | "cloud" | "connector"; automatic: boolean };
  email: { ready: boolean; monthlyPl: boolean };
  ai: { enabled: boolean; keySet: boolean; useClaude: boolean };
  autopay: { mode: "demo" | "live"; keysSet: boolean };
  licence: { configured: boolean };
  updates: { configured: boolean };
};

export type OnlineServiceRow = { key: string; name: string; on: boolean; state: string; sends: string };

export function onlineServices(s: OnlineServicesState): OnlineServiceRow[] {
  const wa = s.whatsapp.mode === "demo";
  const claude = s.ai.enabled && s.ai.keySet && s.ai.useClaude;
  const live = s.autopay.mode === "live";
  return [
    {
      key: "whatsapp",
      name: "WhatsApp",
      on: !wa,
      state: wa ? "Not linked" : `${s.whatsapp.mode === "cloud" ? "WhatsApp Business (Meta)" : "Linked phone"}${s.whatsapp.automatic ? ", automatic messages on" : ", staff send only"}`,
      sends: wa
        ? "Nothing. Messages are saved on this computer."
        : `Each message's text and the member's WhatsApp number, through WhatsApp's servers${s.whatsapp.automatic ? "; automatic messages include renewal invoices as PDFs" : ""}.`,
    },
    {
      key: "email",
      name: "Email",
      on: s.email.ready,
      state: s.email.ready ? (s.email.monthlyPl ? "Set up, monthly profit and loss on" : "Set up") : "Not set up",
      sends: s.email.ready
        ? `Support tickets you raise (your message, and the gym and app details listed under System details)${s.email.monthlyPl ? "; last month's profit and loss to the Super Admins on the 1st" : ""}, through your mail server.`
        : "Nothing.",
    },
    {
      key: "ai",
      name: "Fitron AI",
      on: claude,
      state: !s.ai.enabled ? "Off" : claude ? "Claude on" : "Answers from this computer",
      sends: claude ? "Each question, the chat so far, and the records looked up to answer it, to Anthropic's Claude (USA)." : "Nothing.",
    },
    {
      key: "autopay",
      name: "UPI autopay",
      on: live,
      state: live ? (s.autopay.keysSet ? "Live (Razorpay)" : "Live, Razorpay keys missing") : "Demo",
      sends: live ? "For each mandate: the plan name, the amount, the first debit date and the member's FITRON code, to Razorpay. Not the member's name or phone." : "Nothing. Debits are simulated on this computer.",
    },
    {
      key: "licence",
      name: "Licence",
      on: s.licence.configured,
      state: s.licence.configured ? "Checks online now and then" : "Not set up",
      sends: s.licence.configured ? "The licence id, this installation's id, the edition, plan and app version. Never gym data." : "Nothing.",
    },
    {
      key: "updates",
      name: "Updates",
      on: s.updates.configured,
      state: s.updates.configured ? "Checks for new versions" : "Not set up",
      sends: s.updates.configured ? "The edition, app version, update channel and kind of Windows. Never gym data." : "Nothing.",
    },
  ];
}
