import "server-only";
import nodemailer from "nodemailer";
import { log } from "@/lib/log";
import { isLocal } from "@/lib/runtime/edition";
import { OfflineError, offlineMessage, online, probablyOnline } from "../online";

// Outgoing email over SMTP (any provider: Amazon SES, Zoho, Brevo, Gmail Workspace…).
// Without SMTP_HOST, mail is logged instead of sent, like the other integrations' demo mode. On FITRON for Windows a
// send first checks that the computer is online (src/lib/integrations/online.ts, at most 1.5 s) and says plainly when it
// is not, instead of waiting on nodemailer's DNS and connect timeouts or showing a raw "getaddrinfo ENOTFOUND". The
// shorter timeouts below bound a send that loses the connection part-way.

export const emailReady = () => !!process.env.SMTP_HOST?.trim();

let transport: ReturnType<typeof nodemailer.createTransport> | undefined;
function smtp() {
  transport ??= nodemailer.createTransport({
    host: process.env.SMTP_HOST!.trim(),
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? "" } : undefined,
    dnsTimeout: 5_000,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
  });
  return transport;
}

/** Whether the gym's mail server answers, for FITRON for Windows to say "offline" before trying (a quick check, cached). */
export const emailReachable = () => probablyOnline({ host: process.env.SMTP_HOST?.trim() ?? "", port: Number(process.env.SMTP_PORT || 587) });

export type Attachment = { filename: string; content: Uint8Array; contentType: string };

export async function sendEmail(mail: { to: string; subject: string; text: string; replyTo?: string; attachments?: Attachment[] }) {
  if (!emailReady()) {
    log.info("email.demo", { to: mail.to, subject: mail.subject, attachments: mail.attachments?.map((a) => a.filename).join(", ") });
    return { sent: false as const };
  }
  const { attachments, ...rest } = mail;
  const send = () => smtp().sendMail({ from: process.env.MAIL_FROM || "FITRON <hello@fitron.in>", ...rest, attachments: attachments?.map((a) => ({ filename: a.filename, content: Buffer.from(a.content), contentType: a.contentType })) });
  if (isLocal() && !(await emailReachable())) throw new OfflineError(offlineMessage("Sending email"));
  await (isLocal() ? online("Sending email", send) : send());
  return { sent: true as const };
}
