import { Link, type PageProps } from "optz";
import { PostList } from "$components/PostList";
import { Button } from "$components/ui/button";
import { Arrow } from "$components/Icons";
import Trail from "$components/Trail.island";
import { TrailLines } from "$components/TrailLines";
import { listPosts, type PostMeta } from "$lib/posts";
import site from "$lib/site";

export const loader = () => ({ posts: listPosts().slice(0, 5) });
export default function Home({ data }: PageProps<{ posts: PostMeta[] }, "/">) {
  return <>
    <section className="home-hero dark-surface" aria-labelledby="home-title">
      <div className="site-container"><h1 id="home-title">Curiosity, in progress.</h1></div>
      <Trail mode="flow" />
      <div className="site-container home-intro-bottom">
        <div><p>{site.about}</p><Button asChild size="lg"><Link href="/lab">Explore my work<Arrow /></Link></Button></div>
        <span className="author-note">{site.tagline}</span>
      </div>
    </section>
    <section className="content-section site-container" aria-labelledby="workbench">
      <div className="section-top"><h2 id="workbench">From the workbench</h2><Link href="/lab" className="text-link">All projects<Arrow /></Link></div>
      <Link href="/docs/engine" className="work-row"><div><h3>The $12 Server Challenge</h3><span>Rust / io_uring / SQLite</span></div><p>A social network backend. One CPU, 2 GB of memory, and a lot of room to experiment.</p><Arrow /></Link>
      <Link href="/blog" className="work-row"><div><h3>Development notes</h3><span>What I learn along the way</span></div><p>Debugging, benchmarks, and the small details that make software work better.</p><Arrow /></Link>
    </section>
    <section className="content-section site-container writing-section" aria-labelledby="writing"><div className="section-top"><h2 id="writing">Notes from the build</h2><Link href="/blog" className="text-link">All writing<Arrow /></Link></div><PostList posts={data.posts} /></section>
    <section className="closing-section trail-echo site-container"><TrailLines className="trail-echo-lines" mode="flow" seed={2.1} lanes={28} segments={20} /><h2>Always something<br />worth figuring out.</h2><a className="text-link" href="https://github.com/sxnistxr">Follow the work on GitHub<Arrow /></a></section>
  </>;
}
