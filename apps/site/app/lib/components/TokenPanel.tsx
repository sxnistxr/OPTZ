import { useState, type FormEvent } from "react";
import { decodeToken, setToken, useAuth } from "$lib/auth";

const fmt = (exp: number) => new Date(exp * 1000).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });

export function TokenPanel() {
  const auth = useAuth();
  const [value, setValue] = useState("");
  const [error, setError] = useState("");

  if (auth && !auth.expired) {
    return (
      <p className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
        <span>
          Posting as <strong className="font-semibold">{auth.claims.username}</strong>. Your token expires {fmt(auth.claims.exp)}.
        </span>
        <button onClick={() => setToken(null)} className="text-muted underline decoration-rule underline-offset-4 hover:text-ink">
          Forget token
        </button>
      </p>
    );
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const t = value.trim().replace(/^Bearer\s+/i, "");
    const claims = decodeToken(t);
    if (!claims) return setError("That isn't a valid token. It should be three parts separated by dots.");
    if (claims.exp * 1000 <= Date.now()) return setError("That token has expired. Ask for a new one.");
    setToken(t);
    setValue("");
    setError("");
  };

  return (
    <form onSubmit={submit}>
      <label htmlFor="token" className="text-sm font-medium">
        Paste a token to post and like
      </label>
      <textarea
        id="token"
        rows={2}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        spellCheck={false}
        autoComplete="off"
        placeholder="eyJhbGciOiJIUzI1NiIs…"
        className="mt-2 block w-full break-all rounded-md border border-rule bg-paper px-3 py-2 font-mono text-xs focus:border-ink focus:outline-none"
      />
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm text-muted">The site's owner signs tokens. Yours stays in this browser.</span>
        <button className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-paper hover:opacity-90">Use this token</button>
      </div>
      <p role="alert" className="mt-2 text-sm text-[#c2483d]">
        {error || (auth?.expired ? `Your saved token expired on ${fmt(auth.claims.exp)}. Paste a new one.` : "")}
      </p>
    </form>
  );
}
