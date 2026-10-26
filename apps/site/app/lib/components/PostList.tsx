import { Link } from "optz";
import { formatDate } from "$lib/format";
import type { PostMeta } from "$lib/posts";

export function PostList({ posts }: { posts: PostMeta[] }) {
  return (
    <ol className="space-y-7">
      {posts.map((p) => (
        <li key={p.slug}>
          <Link href={`/blog/${p.slug}`} className="group block">
            <span className="block text-lg font-semibold leading-snug tracking-tight group-hover:underline group-hover:decoration-rule group-hover:underline-offset-4">{p.title}</span>
            {p.summary && <span className="mt-1 block max-w-[36rem] text-muted">{p.summary}</span>}
            <time dateTime={p.date} className="mt-1 block text-sm text-muted">
              {formatDate(p.date)}
            </time>
          </Link>
        </li>
      ))}
    </ol>
  );
}
