"use client";
import { useState } from "react";
import { client } from "$lib/client";
export default function ResetForm({ token }: { token: string }) {
  const [message, setMessage] = useState("");
  return <form onSubmit={async event => {
    event.preventDefault();
    const password = new FormData(event.currentTarget).get("password") as string;
    try { const result = await client.resetPassword({ token, newPassword: password }); setMessage(result.error ? "Recovery failed. Request a new link." : "Password changed. Sign in again."); }
    catch { setMessage("Recovery unavailable. Try again."); }
  }}><label>New password<input name="password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required /></label><button>Set password</button><p role="status">{message}</p><a href="/login">Sign in</a></form>;
}
