import { Link, type Head, type PageProps } from "optz";
import Trail from "$components/Trail.island";
import Pulse from "$components/Pulse.island";
import StartPicker, { type StartOption } from "$components/StartPicker.island";
import { Button } from "$components/ui/button";
import { Arrow } from "$components/Icons";
import { HtmlSpotlight } from "$components/HtmlSpotlight";
import { OptzFeatures } from "$components/OptzFeatures";
import { highlightCode } from "$lib/docs-syntax";
import { getPost, type Post } from "$lib/posts";
import benchmark from "../../../bench/results.json";
import payload from "$content/optz-payload.json";
import site from "$lib/site";

export const head = (): Head => ({ title: "OPTZ — Blink. It’s served.", description: "A React framework for Bun. HTML first, tiny islands, and less work per request. Explore the architecture, documented benchmarks, and getting-started guide." });

export const loader = () => {
  const post = getPost("sqlite-was-reparsing-my-query");
  if (!post) throw new Error("The HTML spotlight example post is missing");
  return { post };
};
const kb = (bytes: number) => (bytes / 1000).toFixed(1);
const throughput = benchmark.optz.paths["/"].rps.median;
const comparison = benchmark.next.paths["/"].rps.median;

const foundation = [
  { title: "Bun", text: "The runtime, bundler and test runner OPTZ is built on. One install, one fast toolchain.", icon: <path d="M5 17h14M7 13l3-3-3-3M12 13h5" /> },
  { title: "React 19", text: "Pages are React components, rendered to HTML at build time or when a request needs it.", icon: <><circle cx="12" cy="12" r="2" /><ellipse cx="12" cy="12" rx="9" ry="3.6" /><ellipse cx="12" cy="12" rx="9" ry="3.6" transform="rotate(60 12 12)" /><ellipse cx="12" cy="12" rx="9" ry="3.6" transform="rotate(120 12 12)" /></> },
  { title: "Preact islands", text: "Islands hydrate with Preact, about 4 KB, so interactive parts stay small.", icon: <><rect x="4" y="4" width="7" height="7" rx="1.5" /><rect x="13" y="13" width="7" height="7" rx="1.5" /><path d="M13 7.5h7M4 16.5h7" /></> },
];

const clone = [`git clone ${site.repo}`, "cd OPTZ", "bun install"];
/** Every way in, with the commands that start it. The two templates are `optz create`'s; the rest are repository apps. */
const startOptions: StartOption[] = ([
  { title: "New app", text: "A static page, a page with params, an island, a typed API route and middleware.", commands: ["bunx @sxnistxr/optz create my-app", "cd my-app", "bun add optz@npm:@sxnistxr/optz", "bun run dev"], guide: "Learn OPTZ step by step", href: "/docs/learn-create" },
  { title: "Full-stack app", text: "Accounts, revocable SQLite sessions, private notes and live updates.", commands: ["bunx @sxnistxr/optz create my-app --template fullstack", "cd my-app", "bun add optz@npm:@sxnistxr/optz", "cp .env.example .env", "bun run dev"], guide: "Read the full-stack guide", href: "/docs/full-stack" },
  { title: "Every feature", text: "Streaming, Server Actions, ISR and draft mode together in one small app.", commands: [...clone, "cd apps/features", "bun run dev"], guide: "Tour the features app", href: "/docs/features-app" },
  { title: "Authentication", text: "Providers, sessions and passkeys through the optional Better Auth integration.", commands: [...clone, "cd apps/auth", "cp .env.example .env", "bun run dev"], guide: "Read the authentication guide", href: "/docs/authentication" },
  { title: "Existing project", text: "Add OPTZ to a Bun project you already have.", commands: ["bun add optz@npm:@sxnistxr/optz react react-dom"], guide: "Read the framework reference", href: "/docs/framework" },
] satisfies Omit<StartOption, "lines">[]).map(o => ({ ...o, lines: o.commands.map(c => highlightCode(c, "sh")) }));

export default function Optz({ data }: PageProps<{ post: Post }, "/optz">) {
  return <div className="optz-overview">
    <section className="optz-hero dark-surface" aria-labelledby="optz-title">
      <div className="site-container optz-intro" data-scene-text><h1 id="optz-title">Blink. <span className="nowrap">It’s served.</span></h1><p>The React framework for Bun that gets out of the way.{" "}<br />HTML first. Tiny islands. Less work per request.</p><div className="hero-actions"><Button asChild size="lg"><Link href="/docs/getting-started">Start building<Arrow /></Link></Button><Button asChild variant="outline" size="lg"><Link href="/docs">Read the docs</Link></Button></div></div>
      <Trail mode="speed" />
    </section>

    <OptzFeatures />

    <section className="content-section site-container optz-performance" aria-labelledby="benchmark-title">
      <div className="section-top"><h2 id="benchmark-title">Fast is a measurable thing.</h2><Link className="text-link" href="/docs/vs-nextjs">Method and tradeoffs<Arrow /></Link></div>
      <figure className="benchmark"><figcaption>Static page throughput <span>requests / second · higher is better</span></figcaption><div className="benchmark-row"><strong>OPTZ</strong><div className="benchmark-track"><svg className="benchmark-bar optz-bar" viewBox={`0 0 ${throughput} 30`} preserveAspectRatio="none" aria-hidden="true"><rect width={throughput} height="30" /></svg></div><span>{Math.round(throughput).toLocaleString("en-US")}</span></div><div className="benchmark-row"><strong>Next.js 16</strong><div className="benchmark-track"><svg className="benchmark-bar next-bar" viewBox={`0 0 ${throughput} 30`} preserveAspectRatio="none" aria-hidden="true"><rect width={comparison} height="30" /></svg></div><span>{Math.round(comparison).toLocaleString("en-US")}</span></div><div className="benchmark-axis" aria-hidden="true"><span>0</span><span>{Math.round(throughput / 2).toLocaleString("en-US")}</span><span>{Math.round(throughput).toLocaleString("en-US")}</span></div></figure>
      <p className="benchmark-note">The same static app on one CPU core, production builds, 64 connections, median of three 10-second runs. Measured October 27, 2026 on the historical portfolio build; results vary by workload and hardware.</p>
      <dl className="performance-facts"><div><dt>Production build</dt><dd>{benchmark.build_s.optz.median.toFixed(2)}<span>s</span></dd><p>Warm font cache</p></div><div><dt>Cold start</dt><dd>{Math.round(benchmark.optz.cold_start_s.median * 1000)}<span>ms</span></dd><p>Median of five starts</p></div><div><dt>Idle memory</dt><dd>{(benchmark.optz.idle_rss_kib / 1024).toFixed(1)}<span>MiB</span></dd><p>Resident process memory</p></div></dl>
    </section>

    <section className="content-section site-container html-section" aria-labelledby="html-title">
      <div className="html-copy"><h2 id="html-title">What arrives<br />is HTML.</h2><p>A post on this site is a document, ready to read. JavaScript adds navigation and interaction where you want them.</p><Link href="/docs/framework#islands-the-payload-optimization" className="text-link">Pages & islands<Arrow /></Link>
        <dl className="payload-facts"><div><dt>of HTML</dt><dd>{kb(payload.htmlBytes)}<span>KB</span></dd><small>{kb(payload.htmlGzipBytes)} KB compressed</small></div><div><dt>of JavaScript</dt><dd>{kb(payload.javascriptGzipBytes)}<span>KB</span></dd><small>Compressed transfer</small></div></dl>
        <p className="payload-note">Measured on the <Link href="/blog/sqlite-was-reparsing-my-query">SQLite post</Link>, {payload.measuredAt}. Gzip, excluding CSS and fonts. <Link href="/docs/html-spotlight#payload-measurements">Measurement details</Link></p>
      </div>
      <HtmlSpotlight post={data.post} />
    </section>

    <section className="content-section site-container mechanism" aria-labelledby="mechanism-title"><div className="mechanism-copy"><h2 id="mechanism-title">Do the work<br />before the request.</h2><p>Render, compress, and hash your static pages at build time. When a request arrives, OPTZ looks up the prepared response in memory.</p><Link href="/docs/architecture" className="text-link">Inside the framework<Arrow /></Link></div><div className="request-path"><div className="path-stage"><span>At build time</span><p>React pages</p><span className="path-connector" aria-hidden="true"><Arrow /></span><p>Render, compress, hash</p></div><div className="path-stage"><span>On request</span><p><code>GET /</code><Arrow /><span>Memory lookup</span><Arrow /><code className="served-chip">200 OK</code></p></div></div></section>

    <section className="content-section site-container" aria-labelledby="foundation-title">
      <h2 id="foundation-title" className="section-title">Built on a small,<br />fast foundation.</h2>
      <div className="foundation-grid">
        {foundation.map((f) => <article key={f.title} className="foundation-card">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{f.icon}</svg>
          <h3>{f.title}</h3>
          <p>{f.text}</p>
        </article>)}
      </div>
      <Pulse />
    </section>

    <section className="content-section site-container get-started" aria-labelledby="start-title">
      <div className="product-section-intro"><h2 id="start-title">Less waiting.<br />More building.</h2><p>Pick a starting point. Each one is a few commands from a running app on Bun 1.4.4 or newer.</p></div>
      <StartPicker options={startOptions} />
    </section>
    <nav className="optz-resource-footer site-container" aria-label="OPTZ resources">
      <div><h2>Start building</h2><Link href="/docs/getting-started">Quickstart</Link><Link href="/docs/framework">Framework reference</Link><Link href="/docs/full-stack">Full-stack guide</Link><Link href="/docs/features-app">Example apps</Link></div>
      <div><h2>Look underneath</h2><Link href="/docs/architecture">Architecture</Link><Link href="/docs/vs-nextjs">Benchmarks</Link><Link href="/docs/html-spotlight">How the spotlight works</Link><Link href="/docs/deployment">Deployment</Link></div>
      <div><h2>From DihLabs</h2><Link href="/">The lab</Link><Link href="/blog">Development notes</Link><Link href="/docs/contributing">Contributing</Link><a href={`${site.repo}/blob/${site.branch}/LICENSE`}>MIT license</a></div>
    </nav>
  </div>;
}
