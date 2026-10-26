"use client";

import { useCallback, useEffect, useState } from "react";
import { social, type Post } from "$lib/social";
import { PostItem } from "./PostItem";




export interface FeedProps {
  limit?: number;
  extra?: Post[];
  refreshable?: boolean;
}

/** The newest posts, fetched in the browser from the engine. `extra` posts go on top. */
export default function Feed({ limit = 20, extra = [], refreshable = false }: FeedProps) {
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(() => {
    setError("");
    social.feed().then(
      (p) => setPosts(p.slice(0, limit)),
      (e: Error) => setError(e.message),
    );
  }, [limit]);
  useEffect(load, [load]);

  const shown = [...extra, ...(posts ?? []).filter((p) => !extra.some((x) => x.id === p.id))].slice(0, limit);
  return (
    <div className="max-w-[40rem]">
      {refreshable && (
        <div className="mb-4 flex items-baseline justify-between gap-4">
          <h2 className="text-sm font-medium text-muted">Newest {limit} posts</h2>
          <button onClick={load} className="text-sm text-muted underline decoration-rule underline-offset-4 hover:text-ink">
            Load newest
          </button>
        </div>
      )}
      <ol className="divide-y divide-rule border-y border-rule" aria-busy={posts === null && !error}>
        {error ? (
          <li className="py-5 text-muted">{error}</li>
        ) : posts === null ? (
          <li className="py-5 text-muted">Loading the feed</li>
        ) : shown.length === 0 ? (
          <li className="py-5 text-muted">No posts yet. Add a token and write the first one.</li>
        ) : (
          shown.map((p) => <PostItem key={p.id} post={p} />)
        )}
      </ol>
    </div>
  );
}
