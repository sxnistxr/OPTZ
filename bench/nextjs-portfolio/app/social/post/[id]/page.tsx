import type { Metadata } from "next";
import Link from "next/link";
import PostView from "$components/PostView";
import site from "$lib/site";

// Rendered per request (Next has no "one static shell for every id" mode without a rewrite);
// the client component loads the post in the browser, as in optz.
export const metadata: Metadata = { title: `Post | ${site.title}` };

export default function PostPage() {
  return (
    <>
      <p>
        <Link href="/social" className="text-muted hover:text-ink">
          Back to the feed
        </Link>
      </p>
      <PostView />
    </>
  );
}
