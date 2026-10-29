"use client";
import { useState } from "react";
import { client } from "$lib/client";

export default function AuthPanel({ email = false, phone = false, providers = [], account = false }: { email?: boolean; phone?: boolean; providers?: string[]; account?: boolean }) {
  const [message, setMessage] = useState(""), [busy, setBusy] = useState(false);
  const [recovery, setRecovery] = useState<string[]>([]), [totpURI, setTotpURI] = useState("");
  const run = async (action: () => Promise<unknown>, success = "Request complete.") => {
    setBusy(true); setMessage("");
    try {
      const result = await action() as { error?: { message?: string }; data?: { twoFactorRedirect?: boolean } } | undefined;
      setMessage(result?.error ? result.error.message ?? "The request could not be completed." : result?.data?.twoFactorRedirect ? "Enter your authenticator or recovery code to finish signing in." : success);
    } catch { setMessage("The request could not be completed. Try again."); }
    finally { setBusy(false); }
  };
  const post = (path: string, data: Record<string, string | boolean>) => fetch("/api/auth" + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }).then(async response => {
    const result = await response.json();
    return response.ok ? { data: result } : { error: { message: result.message ?? "Request denied." } };
  });
  const form = (event: React.FormEvent<HTMLFormElement>, action: (values: Record<string, string>) => Promise<unknown>, success?: string) => {
    event.preventDefault(); const data = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;
    void run(() => action(data), success);
  };
  return <div className="auth-panel"><p role="status" aria-live="polite">{message}</p><fieldset disabled={busy}>
    {!account && <>
      {providers.length > 0 && <section><h2>Continue with a provider</h2>{providers.map(provider => <button key={provider} onClick={() => void run(() => client.signIn.social({ provider, callbackURL: "/account" }))}>{provider}</button>)}</section>}
      <section><h2>Passkey</h2><button onClick={() => void run(() => client.signIn.passkey(), "Signed in. Open your account.")}>Sign in with a passkey</button></section>
      {email && <>
        <section><h2>Email and password</h2><form onSubmit={event => form(event, values => post("/sign-in/email", values), "Signed in. Open your account.")}><label>Email<input name="email" type="email" autoComplete="username" required /></label><label>Password<input name="password" type="password" autoComplete="current-password" required maxLength={128} /></label><button>Sign in</button></form></section>
        <section><h2>Create an account</h2><form onSubmit={event => form(event, values => post("/sign-up/email", values), "Check your email to verify your account, then sign in.")}><label>Name<input name="name" required maxLength={80} /></label><label>Email<input name="email" type="email" autoComplete="email" required /></label><label>Password<input name="password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required /></label><button>Register</button></form></section>
        <section><h2>Email code</h2><form onSubmit={event => form(event, values => post("/email-otp/send-verification-otp", { ...values, type: "sign-in" }), "If eligible, a code is on its way.")}><label>Email<input name="email" type="email" required /></label><button>Send code</button></form><form onSubmit={event => form(event, values => post("/sign-in/email-otp", values), "Signed in. Open your account.")}><label>Email<input name="email" type="email" required /></label><label>Code<input name="otp" inputMode="numeric" autoComplete="one-time-code" required /></label><button>Verify email code</button></form></section>
        <section><h2>Email link</h2><form onSubmit={event => form(event, values => post("/sign-in/magic-link", { ...values, callbackURL: "/account" }), "If eligible, a sign-in link is on its way.")}><label>Email<input name="email" type="email" required /></label><button>Send sign-in link</button></form></section>
        <section><h2>Reset password</h2><form onSubmit={event => form(event, values => post("/request-password-reset", { ...values, redirectTo: "/reset" }), "If eligible, a recovery link is on its way.")}><label>Email<input name="email" type="email" required /></label><button>Send recovery link</button></form></section>
      </>}
      {phone && <section><h2>Phone code</h2><form onSubmit={event => form(event, values => post("/phone-number/send-otp", values), "If eligible, an SMS code is on its way.")}><label>Phone in E.164<input name="phoneNumber" type="tel" autoComplete="tel" placeholder="+15551234567" required /></label><button>Send SMS</button></form><form onSubmit={event => form(event, values => post("/phone-number/verify", values), "Verified. Open your account.")}><label>Phone<input name="phoneNumber" type="tel" required /></label><label>SMS code<input name="code" inputMode="numeric" autoComplete="one-time-code" required /></label><button>Verify SMS</button></form></section>}
      {!email && !phone && providers.length === 0 && <p>Configure an email, SMS, or OAuth provider on the server to register your first account.</p>}
    </>}
    <section><h2>Second factor or recovery code</h2><form onSubmit={event => form(event, values => post("/two-factor/verify-totp", { ...values, trustDevice: false }), "Verified. Open your account.")}><label>Authenticator code<input name="code" inputMode="numeric" autoComplete="one-time-code" required /></label><button>Verify authenticator</button></form><form onSubmit={event => form(event, values => post("/two-factor/verify-backup-code", { ...values, trustDevice: false }), "Verified. Open your account.")}><label>Single-use recovery code<input name="code" autoComplete="off" required /></label><button>Use recovery code</button></form></section>
    {account && <>
      <section><h2>Add a passkey</h2><button onClick={() => void run(() => client.passkey.addPasskey({ name: "My passkey" }), "Passkey added.")}>Register a passkey</button></section>
      <section><h2>Set up an authenticator</h2><form onSubmit={event => form(event, async values => {
        const result = await client.twoFactor.enable({ password: values.password || undefined });
        if (result.data && "totpURI" in result.data) { setTotpURI(result.data.totpURI); setRecovery(result.data.backupCodes); }
        return result;
      }, "Add the secret to your authenticator, save recovery codes, then verify a code above to activate protection.")}><label>Current password (leave empty for passwordless accounts)<input name="password" type="password" autoComplete="current-password" /></label><button>Begin enrollment</button></form></section>
      {totpURI && <section><h2>Authenticator setup</h2><p>Enter this secret into your authenticator app:</p><code>{new URL(totpURI).searchParams.get("secret")}</code></section>}
      {recovery.length > 0 && <section><h2>Save these recovery codes securely</h2><p>Each code can be used once. Keep them separate from your authenticator.</p><pre>{recovery.join("\n")}</pre><button onClick={() => { setRecovery([]); setTotpURI(""); }}>Hide saved codes</button></section>}
      <button onClick={() => void run(() => client.signOut(), "Signed out.")}>Sign out</button>
    </>}
    <p><a href="/account">Open your account</a></p>
  </fieldset></div>;
}
