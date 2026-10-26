import { Link, type Head } from "optz";
import PostView from "$components/PostView.island";
import site from "$lib/site";

// One shell for every post id; the island loads the post in the browser. New posts never
// need a rebuild, and the server does no work per post.
export const config = { render: "client" } as const;
export const head = (): Head => ({ title: `Post | ${site.title}` });

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
