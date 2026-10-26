import { useState, type FormEvent } from "react";
import { api, type Post } from "$lib/api";
import { useActiveAuth } from "$lib/auth";

export function Compose({ onPosted }: { onPosted: (p: Post) => void }) {
  const auth = useActiveAuth();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!auth) return null;
  const n = [...body.trim()].length;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      onPosted(await api.create(body));
      setBody("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="mt-6 max-w-[38rem]">
      <label htmlFor="compose-body" className="text-sm font-medium">
        Write a post
      </label>
      <textarea
        id="compose-body"
        rows={3}
        maxLength={500}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="What are you working on?"
        className="mt-2 block w-full resize-y rounded-md border border-rule bg-paper px-3 py-2.5 text-[1.05rem] leading-relaxed placeholder:text-muted focus:border-ink focus:outline-none"
      />
      <div className="mt-2 flex items-center justify-between gap-4">
        <span className="text-sm tabular-nums text-muted">{n} of 500</span>
        <button disabled={busy || n === 0 || n > 500} className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-paper hover:opacity-90 disabled:opacity-50">
          {busy ? "Posting" : "Post"}
        </button>
      </div>
      <p role="alert" className="mt-2 text-sm text-[#c2483d]">
        {error}
      </p>
    </form>
  );
}
