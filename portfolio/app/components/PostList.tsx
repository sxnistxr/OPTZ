import { Link } from "optz";
import { formatDate } from "$lib/format";
import type { PostMeta } from "$lib/posts";

/** Posts as rows: the title, one sentence, and the date set apart on the right. */
export function PostList({ posts }: { posts: PostMeta[] }) {
  return (
    <ol className="post-list">
      {posts.map((p) => (
        <li key={p.slug}>
          <Link href={`/blog/${p.slug}`} className="post-link">
            <span className="post-title">{p.title}</span>
            {p.summary && <span className="post-summary">{p.summary}</span>}
            <time dateTime={p.date} className="post-date">
              {formatDate(p.date)}
            </time>
          </Link>
        </li>
      ))}
    </ol>
  );
}
