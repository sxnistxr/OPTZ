import { Link, type PageProps } from "optz";
import { LabList } from "$components/Lab";
import { PostList } from "$components/PostList";
import Pulse from "$components/Pulse.island";
import lab from "$lib/lab";
import { listPosts, type PostMeta } from "$lib/posts";
import site from "$lib/site";

// Static: runs once at build time; the browser gets the HTML and one small island.
export const loader = () => ({ posts: listPosts().slice(0, 5) });

export default function Home({ data }: PageProps<{ posts: PostMeta[] }, "/">) {
  return (
    <>
      <div className="home-intro">
        <p className="intro-byline">{site.tagline}</p>
        <h1>{site.name}</h1>
        <p className="intro-description">{site.about}</p>
        <div className="intro-links">
          <Link href="/lab" className="primary-link">Explore the lab</Link>
          {site.links.map((l) => <a key={l.href} href={l.href}>{l.label}</a>)}
        </div>
      </div>
      <Pulse />

      <section className="home-section" aria-labelledby="lab">
        <h2 id="lab" className="section-heading">
          In the lab
        </h2>
        <LabList items={lab} />
      </section>

      <section className="home-section" aria-labelledby="writing">
        <h2 id="writing" className="section-heading">
          Writing
        </h2>
        <PostList posts={data.posts} />
      </section>

      <section className="home-section home-docs" aria-labelledby="docs">
        <h2 id="docs" className="section-heading">
          The code behind it
        </h2>
        <p className="text-lg leading-relaxed">
          This site runs on optz, a React framework for Bun built in this lab, on a $1.50 server. The docs cover how to build on it, how it's made, and how
          fast it is.
        </p>
        <p className="mt-4 flex flex-wrap gap-x-5 gap-y-2">
          <Link href="/docs" className="underline decoration-rule underline-offset-4 hover:decoration-ink">
            Read the docs
          </Link>
          <Link href="/docs/why-optz" className="underline decoration-rule underline-offset-4 hover:decoration-ink">
            Why optz
          </Link>
          <Link href="/docs/vs-nextjs" className="underline decoration-rule underline-offset-4 hover:decoration-ink">
            optz vs Next.js
          </Link>
        </p>
      </section>
    </>
  );
}
