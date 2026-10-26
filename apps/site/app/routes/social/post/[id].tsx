import { useEffect, useState } from "react";
import { Link, useParams, type Head } from "optz";
import { api, type Post } from "$lib/api";
import { PostItem } from "$lib/components/PostItem";
import site from "$lib/site";

// One shell for every post id; the post loads in the browser from the API. The Bun server does
// no work per post, and new posts never need a rebuild.
export const config = { render: "client" } as const;
export const head = (): Head => ({ title: `Post | ${site.title}` });

export default function PostPage() {
  const { id } = useParams<{ id: string }>();
  const [post, setPost] = useState<Post | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!id) return;
    setPost(null);
    setError("");
    api.post(id).then(
      (p) => {
        setPost(p);
        document.title = `${p.author}: ${p.body.slice(0, 50)}`;
      },
      (e) => setError(e.status === 404 ? "This post doesn't exist. It may have the wrong id." : e.message),
    );
  }, [id]);
  return (
    <>
      <p>
        <Link href="/social" className="text-muted hover:text-ink">
          Back to the feed
        </Link>
      </p>
      <ol className="mt-8 max-w-[40rem] divide-y divide-rule border-y border-rule">
        {post ? <PostItem post={post} /> : <li className="py-5 text-muted">{error || "Loading the post"}</li>}
      </ol>
    </>
  );
}
