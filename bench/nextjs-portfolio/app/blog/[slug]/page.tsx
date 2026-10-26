import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { formatDate } from "$lib/format";
import { getPost, listPosts } from "$lib/posts";
import site from "$lib/site";

export const dynamicParams = false;
export const generateStaticParams = () => listPosts().map((p) => ({ slug: p.slug }));

export async function generateMetadata({ params }: PageProps<"/blog/[slug]">): Promise<Metadata> {
  const post = getPost((await params).slug);
  return post ? { title: `${post.title} | ${site.title}`, description: post.summary ?? post.title } : {};
}

export default async function BlogPost({ params }: PageProps<"/blog/[slug]">) {
  const post = getPost((await params).slug) ?? notFound();
  return (
    <article>
      <header className="max-w-[38rem]">
        <time dateTime={post.date} className="text-sm text-muted">
          {formatDate(post.date)}
        </time>
        <h1 className="mt-2 text-4xl font-semibold leading-[1.08] tracking-[-0.02em] md:text-5xl">{post.title}</h1>
      </header>
      <div className="prose-post mt-10" dangerouslySetInnerHTML={{ __html: post.html }} />
      <p className="mt-14">
        <Link href="/blog" className="text-muted hover:text-ink">
          All writing
        </Link>
      </p>
    </article>
  );
}
