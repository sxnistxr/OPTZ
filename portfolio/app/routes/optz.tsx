import { Link, type Head, type Href } from "optz";
import Trail from "$components/Trail.island";
import Pulse from "$components/Pulse.island";
import CopyCommand from "$components/CopyCommand.island";
import { Button } from "$components/ui/button";
import { Arrow } from "$components/Icons";
import { PrebuiltIllustration, IslandsIllustration, RoutesIllustration } from "$components/OptzIllustrations";
import site from "$lib/site";

export const head = (): Head => ({ title: "OPTZ — Blink. It’s served.", description: "A React framework for Bun. HTML first, tiny islands, and less work per request. Explore the architecture, documented benchmarks, and getting-started guide." });

const pillars = [
  { title: "Rendered before the request", text: "Static pages are rendered, compressed and hashed at build time, then served straight from memory.", href: "/docs/architecture", art: <PrebuiltIllustration /> },
  { title: "Islands, not bundles", text: "Pages arrive as HTML. Only the components you mark as islands ship JavaScript, and each hydrates on its own.", href: "/docs/framework", art: <IslandsIllustration /> },
  { title: "Typed from file to link", text: "Files become routes and APIs. Every link and API call is checked against them when you type-check.", href: "/docs/framework", art: <RoutesIllustration /> },
] as const;

const features: [string, string, Href][] = [
  ["Server Actions", "Call server code from a form or a button. Forms still submit with JavaScript turned off.", "/docs/framework"],
  ["Streaming", "Send the page shell first and stream slower parts in as they resolve, with loading states.", "/docs/framework"],
  ["Incremental regeneration", "Rebuild a static page in the background, on a timer or on demand.", "/docs/framework"],
  ["Client navigation", "Links swap page HTML in place and prefetch on hover, for about 2 KB.", "/docs/framework"],
  ["Fonts and images", "Fonts are downloaded at build time and served from your domain with size-matched fallbacks.", "/docs/framework"],
];

const foundation = [
  { title: "Bun", text: "The runtime, bundler and test runner OPTZ is built on. One install, one fast toolchain.", icon: <path d="M5 17h14M7 13l3-3-3-3M12 13h5" /> },
  { title: "React 19", text: "Pages are React components, rendered to HTML at build time or when a request needs it.", icon: <><circle cx="12" cy="12" r="2" /><ellipse cx="12" cy="12" rx="9" ry="3.6" /><ellipse cx="12" cy="12" rx="9" ry="3.6" transform="rotate(60 12 12)" /><ellipse cx="12" cy="12" rx="9" ry="3.6" transform="rotate(120 12 12)" /></> },
  { title: "Preact islands", text: "Islands hydrate with Preact, about 4 KB, so interactive parts stay small.", icon: <><rect x="4" y="4" width="7" height="7" rx="1.5" /><rect x="13" y="13" width="7" height="7" rx="1.5" /><path d="M13 7.5h7M4 16.5h7" /></> },
];

const starters: { title: string; text: string; path: string; href: Href }[] = [
  { title: "Starter", text: "A static page, a page with params, an island, a typed API route and middleware.", path: "optz create", href: "/docs/getting-started" },
  { title: "Full-stack", text: "Accounts, revocable SQLite sessions, private notes and live updates.", path: "apps/fullstack", href: "/docs/full-stack" },
  { title: "Every feature", text: "Streaming, Server Actions, ISR and draft mode together in one small app.", path: "apps/features", href: "/docs/features-app" },
  { title: "Authentication", text: "Providers, sessions and passkeys through the optional Better Auth integration.", path: "apps/auth", href: "/docs/authentication" },
];

export default function Optz() {
  return <>
    <section className="optz-hero dark-surface" aria-labelledby="optz-title">
      <div className="site-container optz-intro" data-scene-text><h1 id="optz-title">Blink. <span className="nowrap">It’s served.</span></h1><p>The React framework for Bun that gets out of the way.{" "}<br />HTML first. Tiny islands. Less work per request.</p><div className="hero-actions"><Button asChild size="lg"><Link href="/docs/getting-started">Start building<Arrow /></Link></Button><Button asChild variant="outline" size="lg"><Link href="/docs">Read the docs</Link></Button></div></div>
      <Trail mode="speed" />
    </section>

    <section className="content-section site-container" aria-labelledby="pillars-title">
      <h2 id="pillars-title" className="section-title">Everything a site needs.<br />Nothing it doesn’t.</h2>
      <div className="pillar-grid">
        {pillars.map((p) => <Link key={p.title} href={p.href} className="pillar">
          <div className="pillar-art">{p.art}</div>
          <h3>{p.title}<Arrow /></h3>
          <p>{p.text}</p>
        </Link>)}
      </div>
      <div className="feature-grid">
        {features.map(([title, text, href]) => <Link key={title} href={href} className="feature">
          <h3>{title}<Arrow /></h3>
          <p>{text}</p>
        </Link>)}
        <Link href="/docs/full-stack" className="feature-release">
          <h3>OPTZ 0.4<Arrow /></h3>
          <p>Accounts, persistent data and live updates, when your app needs them.</p>
        </Link>
      </div>
    </section>

    <section className="content-section site-container" aria-labelledby="benchmark-title">
      <div className="section-top"><h2 id="benchmark-title">Fast is a measurable thing.</h2><Link className="text-link" href="/docs/vs-nextjs">Method and tradeoffs<Arrow /></Link></div>
      <figure className="benchmark"><figcaption>Static page throughput <span>in requests per second</span></figcaption><div className="benchmark-row"><strong>OPTZ</strong><div className="benchmark-track"><div className="benchmark-bar optz-bar" /></div><span>26,366</span></div><div className="benchmark-row"><strong>Next.js 16</strong><div className="benchmark-track"><div className="benchmark-bar next-bar" /></div><span>438</span></div></figure>
      <p className="benchmark-note">The same app on one CPU core, production builds, median of three runs. Measured October 27, 2026; results vary by hardware.</p>
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
      <div className="get-started-copy">
        <h2 id="start-title">Get started<br />in seconds.</h2>
        <p>Add OPTZ to a Bun project, or start from one of the example apps in the repository.</p>
        <CopyCommand command="bun add optz@npm:@sxnistxr/optz react react-dom" />
        <div className="get-started-actions"><Button asChild><Link href="/docs/getting-started">Start building</Link></Button><Button asChild variant="outline"><a href={`${site.repo}/tree/${site.branch}/apps`}>All examples</a></Button></div>
      </div>
      <div className="starter-grid">
        {starters.map((s) => <Link key={s.title} href={s.href} className="starter-card">
          <h3>{s.title}</h3>
          <p>{s.text}</p>
          <code>{s.path}</code>
        </Link>)}
      </div>
    </section>

    <section className="closing-cta site-container" aria-labelledby="closing-title">
      <h2 id="closing-title">Less waiting. More building.</h2>
      <div className="closing-actions"><Button asChild size="lg"><Link href="/docs/getting-started">Get started<Arrow /></Link></Button><Button asChild variant="outline" size="lg"><Link href="/docs">Read the docs</Link></Button></div>
    </section>
  </>;
}
