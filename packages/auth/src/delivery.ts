export type EmailPurpose = "verify-email" | "reset-password" | "magic-link" | "sign-in" | "email-verification" | "forget-password" | "change-email" | "second-factor";
export interface EmailMessage { to: string; purpose: EmailPurpose; url?: string; code?: string }
export interface SMSMessage { to: string; code: string; purpose: "sign-in" | "reset-password" | "second-factor" }
export type SendEmail = (message: EmailMessage) => Promise<void>;
export type SendSMS = (message: SMSMessage) => Promise<void>;

const labels: Record<EmailPurpose, string> = {
  "verify-email": "Verify your email", "reset-password": "Reset your password",
  "magic-link": "Your sign-in link", "sign-in": "Your sign-in code",
  "email-verification": "Verify your email", "forget-password": "Reset your password",
  "change-email": "Verify your new email", "second-factor": "Your second-factor code",
};

/** Optional dependency-free Resend adapter. Provider errors never expose request/response bodies. */
export function resend(options: { apiKey: string; from: string; appName?: string; fetch?: typeof fetch }): SendEmail {
  if (!options.apiKey || !options.from || /[\r\n]/.test(options.from)) throw new TypeError("Invalid email provider configuration");
  return async message => {
    const response = await (options.fetch ?? fetch)("https://api.resend.com/emails", {
      method: "POST", signal: AbortSignal.timeout(10000),
      headers: { Authorization: `Bearer ${options.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: options.from, to: [message.to],
        subject: `${options.appName ?? "OPTZ"}: ${labels[message.purpose]}`,
        text: `${labels[message.purpose]}\n\n${message.url ?? message.code}\n\nIf you did not request this, ignore this message.` }),
    });
    await response.body?.cancel();
    if (!response.ok) throw new Error("Email delivery failed");
  };
}

/** Optional Twilio SMS adapter; apply destination allowlists and a provider spending cap. */
export function twilio(options: { accountSid: string; authToken: string; from: string; appName?: string; fetch?: typeof fetch }): SendSMS {
  if (!/^AC[a-fA-F0-9]{32}$/.test(options.accountSid) || !options.authToken || !options.from) throw new TypeError("Invalid SMS provider configuration");
  return async message => {
    const response = await (options.fetch ?? fetch)(`https://api.twilio.com/2010-04-01/Accounts/${options.accountSid}/Messages.json`, {
      method: "POST", signal: AbortSignal.timeout(10000),
      headers: { Authorization: `Basic ${btoa(`${options.accountSid}:${options.authToken}`)}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ From: options.from, To: message.to, Body: `${options.appName ?? "OPTZ"}: ${message.code}. Do not share this code.` }),
    });
    await response.body?.cancel();
    if (!response.ok) throw new Error("SMS delivery failed");
  };
}
