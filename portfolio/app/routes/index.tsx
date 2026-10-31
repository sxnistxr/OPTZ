import { Link, type Head, type PageProps } from "optz";
import { PostList } from "$components/PostList";
import { Button } from "$components/ui/button";
import { Arrow } from "$components/Icons";
import Trail from "$components/Trail.island";
import { TrailLines } from "$components/TrailLines";
import { listPosts, type PostMeta } from "$lib/posts";
import site from "$lib/site";

export const head = (): Head => ({ canonical: "/" });

export const loader = () => ({ posts: listPosts().slice(0, 5) });
export default function Home({ data }: PageProps<{ posts: PostMeta[] }, "/">) {
  const url = process.env.SITE_URL ?? site.url;
  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "WebSite", "@id": `${url}/#website`, url, name: site.name, description: site.about, inLanguage: "en", author: { "@id": `${url}/#author` } },
      { "@type": "Person", "@id": `${url}/#author`, name: site.author, url, sameAs: ["https://github.com/sxnistxr"] },
    ],
  };
  return <>
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, "\\u003c") }} />
    <section className="home-hero dark-surface" aria-labelledby="home-title">
      <div className="site-container home-intro">
        <h1 id="home-title">Curiosity,<br /> in progress.</h1>
        <div className="home-lead"><p>{site.about}</p><Button asChild size="lg"><Link href="/lab">Explore my work<Arrow /></Link></Button></div>
      </div>
      <Trail mode="flow" />
    </section>
    <section className="content-section site-container" aria-labelledby="workbench">
      <div className="section-top"><h2 id="workbench">From the workbench</h2><Link href="/lab" className="text-link">All projects<Arrow /></Link></div>
      <Link href="/optz" className="work-row"><h3>OPTZ</h3><p>The React framework for Bun this site runs on. HTML first, with small islands of JavaScript.</p><Arrow /></Link>
      <Link href="/docs/engine" className="work-row"><h3>The $12 Server Challenge</h3><p>A social network backend in Rust, io_uring and SQLite, on one CPU and 2 GB of memory.</p><Arrow /></Link>
    </section>
    <section className="content-section site-container" aria-labelledby="writing"><div className="section-top"><h2 id="writing">Notes from the build</h2><Link href="/blog" className="text-link">All writing<Arrow /></Link></div><PostList posts={data.posts} /></section>
    <section className="closing-section trail-echo site-container"><TrailLines className="trail-echo-lines" seed={2.1} lanes={28} segments={20} /><h2>Always something<br />worth figuring out.</h2><a className="text-link" href="https://github.com/sxnistxr">Follow the work on GitHub<Arrow /></a></section>
  </>;
}
