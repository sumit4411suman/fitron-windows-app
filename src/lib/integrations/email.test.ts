import { afterEach, describe, expect, it, vi } from "vitest";

const smtp = vi.hoisted(() => ({ sendMail: vi.fn(async () => ({})), options: [] as unknown[] }));
vi.mock("nodemailer", () => ({ default: { createTransport: (o: unknown) => (smtp.options.push(o), { sendMail: smtp.sendMail }) } }));
const net = vi.hoisted(() => ({ up: true }));
vi.mock("./online", async (importOriginal) => ({ ...(await importOriginal<typeof import("./online")>()), probablyOnline: vi.fn(async () => net.up) }));

import { sendEmail } from "./email";

const mail = { to: "owner@example.com", subject: "Hello", text: "Hi" };

afterEach(() => {
  vi.unstubAllEnvs();
  smtp.sendMail.mockReset();
  net.up = true;
});

describe("email on FITRON for Windows", () => {
  it("says the computer is offline before trying the mail server", async () => {
    vi.stubEnv("FITRON_EDITION", "local");
    vi.stubEnv("SMTP_HOST", "smtp.example.com");
    net.up = false;
    await expect(sendEmail(mail)).rejects.toThrow("Sending email requires an internet connection.");
    expect(smtp.sendMail).not.toHaveBeenCalled();
  });

  it("turns a connection lost part-way into the same plain message", async () => {
    vi.stubEnv("FITRON_EDITION", "local");
    vi.stubEnv("SMTP_HOST", "smtp.example.com");
    smtp.sendMail.mockRejectedValueOnce(Object.assign(new Error("getaddrinfo ENOTFOUND smtp.example.com"), { code: "EDNS" }));
    await expect(sendEmail(mail)).rejects.toThrow("Sending email requires an internet connection.");
  });

  it("sends with short timeouts, and leaves a refusal from the mail server as it is", async () => {
    vi.stubEnv("FITRON_EDITION", "local");
    vi.stubEnv("SMTP_HOST", "smtp.example.com");
    expect(await sendEmail(mail)).toEqual({ sent: true });
    expect(smtp.options.at(-1)).toMatchObject({ dnsTimeout: 5_000, connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 30_000 });
    smtp.sendMail.mockRejectedValueOnce(new Error("535 Authentication failed"));
    await expect(sendEmail(mail)).rejects.toThrow("535 Authentication failed");
  });

  it("is unchanged on the Cloud Edition: no online check, and the error as nodemailer gives it", async () => {
    vi.stubEnv("FITRON_EDITION", "cloud");
    vi.stubEnv("SMTP_HOST", "smtp.example.com");
    net.up = false;
    smtp.sendMail.mockRejectedValueOnce(Object.assign(new Error("getaddrinfo ENOTFOUND smtp.example.com"), { code: "EDNS" }));
    await expect(sendEmail(mail)).rejects.toThrow("getaddrinfo ENOTFOUND smtp.example.com");
  });
});
