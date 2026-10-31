import { Link, notFound, type Head, type LoaderContext, type PageProps } from "optz";
import { formatDate } from "$lib/format";
import { getPost, listPosts, type Post } from "$lib/posts";
import site from "$lib/site";

// Static with a parameter: one page per post, rendered at build time.
export const paths = () => listPosts().map((p) => ({ slug: p.slug }));
export const loader = ({ params }: LoaderContext<{ slug: string }>) => getPost(params.slug) ?? notFound();
export const head = (post: Post): Head => ({
  title: `${post.title} | ${site.title}`,
  description: post.summary ?? post.title,
  canonical: `/blog/${post.slug}`,
  openGraph: { type: "article", publishedTime: post.date, authors: [site.name], siteName: site.title },
});

export default function BlogPost({ data: post }: PageProps<Post, "/blog/[slug]">) {
  return (
    <article>
      <header className="post-header">
        <time dateTime={post.date}>{formatDate(post.date)}</time>
        <h1>{post.title}</h1>
      </header>
      {/* Markdown you wrote, rendered at build time. */}
      <div className="prose-post mt-12" dangerouslySetInnerHTML={{ __html: post.html }} />
      <footer className="post-footer">
        <Link href="/blog" className="text-link">All writing</Link>
      </footer>
    </article>
  );
}
