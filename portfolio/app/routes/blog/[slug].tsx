import { Link, notFound, type Head, type LoaderContext, type PageProps } from "optz";
import { formatDate } from "$lib/format";
import { getPost, listPosts, type Post } from "$lib/posts";
import site from "$lib/site";

// Static with a parameter: one page per post, rendered at build time.
export const paths = () => listPosts().map((p) => ({ slug: p.slug }));
export const loader = ({ params }: LoaderContext<{ slug: string }>) => getPost(params.slug) ?? notFound();
export const head = (post: Post): Head => ({ title: `${post.title} | ${site.title}`, description: post.summary ?? post.title });

export default function BlogPost({ data: post }: PageProps<Post, "/blog/[slug]">) {
  return (
    <article>
      <header className="max-w-[38rem]">
        <time dateTime={post.date} className="text-sm text-muted">
          {formatDate(post.date)}
        </time>
        <h1 className="mt-2 text-4xl font-semibold leading-[1.08] tracking-[-0.02em] md:text-5xl">{post.title}</h1>
      </header>
      {/* Markdown you wrote, rendered at build time. */}
      <div className="prose-post mt-10" dangerouslySetInnerHTML={{ __html: post.html }} />
      <p className="mt-14">
        <Link href="/blog" className="text-muted hover:text-ink">
          All writing
        </Link>
      </p>
    </article>
  );
}
