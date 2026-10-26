import { Link } from "optz";
import { useEffect, useState } from "react";
import { social, type Post } from "$lib/social";
import { useActiveAuth } from "$lib/auth";
import { ago, plural } from "$lib/format";

export function PostItem({ post }: { post: Post }) {
  const auth = useActiveAuth();
  const [likes, setLikes] = useState(post.like_count);
  const [liked, setLiked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Relative times depend on the clock, so they're computed after mount, never during render.
  const [when, setWhen] = useState("");
  useEffect(() => setWhen(ago(post.created_at)), [post.created_at]);

  const like = async () => {
    setBusy(true);
    setError("");
    try {
      const r = await social.like(post.id);
      if (!r.already_liked) setLikes((n) => n + 1);
      setLiked(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="py-5">
      <div className="flex items-baseline justify-between gap-4 text-sm">
        <span className="font-medium">{post.author}</span>
        <Link href={`/post/${post.id}`} className="text-muted hover:text-ink">
          <time dateTime={post.created_at}>{when}</time>
        </Link>
      </div>
      <p className="mt-1.5 max-w-[38rem] whitespace-pre-wrap break-words text-[1.05rem] leading-relaxed">{post.body}</p>
      <div className="mt-2.5 flex items-center gap-4">
        {auth && (
          <button
            onClick={like}
            disabled={busy || liked}
            aria-pressed={liked}
            className="rounded border border-rule px-2.5 py-0.5 text-sm hover:border-ink aria-pressed:border-signal"
          >
            {liked ? "Liked" : "Like"}
          </button>
        )}
        <span className="text-sm tabular-nums text-muted">{error || plural(likes, "like")}</span>
      </div>
    </li>
  );
}
