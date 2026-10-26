import { Link, type PageProps } from "optz";
import { Feed } from "$lib/components/Feed";
import { PostList } from "$lib/components/PostList";
import { Pulse } from "$lib/components/Pulse";
import { listPosts, type PostMeta } from "$lib/posts";
import site from "$lib/site";

// Runs at build time (this page is static): the browser gets the result, never this code.
export const loader = () => ({ posts: listPosts().slice(0, 5) });

export default function Home({ data }: PageProps<{ posts: PostMeta[] }>) {
  return (
    <>
      <h1 className="text-5xl font-semibold leading-[1.02] tracking-[-0.03em] md:text-7xl">{site.name}</h1>
      <p className="mt-6 max-w-[36rem] text-lg leading-relaxed md:text-xl">{site.about}</p>
      <p className="mt-4 flex gap-5">
        {site.links.map((l) => (
          <a key={l.href} href={l.href} className="underline decoration-rule underline-offset-4 hover:decoration-ink">
            {l.label}
          </a>
        ))}
      </p>
      <Pulse />

      <section className="mt-20" aria-labelledby="writing">
        <h2 id="writing" className="mb-6 text-sm font-medium text-muted">
          Writing
        </h2>
        <PostList posts={data.posts} />
      </section>

      <section className="mt-20" aria-labelledby="feed">
        <h2 id="feed" className="mb-6 text-sm font-medium text-muted">
          Latest on the feed
        </h2>
        <Feed limit={5} />
        <p className="mt-5">
          <Link href="/social" className="underline decoration-rule underline-offset-4 hover:decoration-ink">
            Open the feed
          </Link>
        </p>
      </section>
    </>
  );
}
