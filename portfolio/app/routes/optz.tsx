import { Link, type Head } from "optz";
import Trail from "$components/Trail.island";
import { SpeedLines } from "$components/SpeedLines";
import Pulse from "$components/Pulse.island";
import { Button } from "$components/ui/button";
import { Arrow } from "$components/Icons";

export const head = (): Head => ({ title: "OPTZ — Blink. It’s served.", description: "A React framework for Bun. HTML first, tiny islands, and less work per request. Explore the architecture, documented benchmarks, and getting-started guide." });
export default function Optz() {
  return <>
    <section className="optz-hero dark-surface" aria-labelledby="optz-title">
      <div className="site-container optz-intro" data-scene-text><h1 id="optz-title">Blink. <span className="nowrap">It’s served.</span></h1><p>The React framework for Bun that gets out of the way.{" "}<br />HTML first. Tiny islands. Less work per request.</p><div className="hero-actions"><Button asChild size="lg"><Link href="/docs/getting-started">Start building<Arrow /></Link></Button><Button asChild variant="outline" size="lg"><Link href="/docs">Read the docs</Link></Button></div></div>
      <Trail mode="speed" />
    </section>
    <section className="content-section site-container" aria-labelledby="benchmark-title">
      <div className="section-top"><h2 id="benchmark-title">Fast is a measurable thing.</h2><Link className="text-link" href="/docs/vs-nextjs">Method and tradeoffs<Arrow /></Link></div>
      <figure className="benchmark"><figcaption>Static page throughput <span>in requests per second</span></figcaption><div className="benchmark-row"><strong>OPTZ</strong><div className="benchmark-track"><div className="benchmark-bar optz-bar" /></div><span>26,366</span></div><div className="benchmark-row"><strong>Next.js 16</strong><div className="benchmark-track"><div className="benchmark-bar next-bar" /></div><span>438</span></div></figure>
      <p className="benchmark-note">The same app on one CPU core, production builds, median of three runs. Measured October 27, 2026; results vary by hardware.</p>
    </section>
    <section className="content-section site-container mechanism" aria-labelledby="mechanism-title"><div className="mechanism-copy"><h2 id="mechanism-title">Do the work<br />before the request.</h2><p>Render, compress, and hash your static pages at build time. When a request arrives, OPTZ looks up the prepared response in memory.</p><Link href="/docs/architecture" className="text-link">Inside the framework<Arrow /></Link></div><div className="request-path"><div className="path-stage"><span>At build time</span><p>React pages</p><span className="path-connector" aria-hidden="true"><Arrow /></span><p>Render, compress, hash</p></div><div className="path-stage"><span>On request</span><p><code>GET /</code><Arrow /><span>Memory lookup</span><Arrow /><code className="served-chip">200 OK</code></p></div></div></section>
    <section className="content-section site-container framework-details" aria-labelledby="framework-title"><div className="section-top"><h2 id="framework-title">Small runtime. Plenty of room.</h2><Link href="/docs/framework" className="text-link">Framework reference<Arrow /></Link></div><div className="feature-columns"><article><h3>HTML comes first</h3><p>Pages arrive ready to read. Only components marked as islands ship interactive JavaScript.</p></article><article><h3>React, end to end</h3><p>Typed routes and APIs, Server Actions, streaming, and incremental static regeneration.</p></article><article><h3>Your server, your call</h3><p>Deploy as a Bun server, a single executable, or an edge worker. Turn unused features off.</p></article></div><Pulse /></section>
    <section className="closing-section trail-echo trail-echo-speed site-container"><SpeedLines className="trail-echo-lines" streaks={40} converge /><div><h2>Less waiting.<br />More building.</h2><p>This site runs on OPTZ. Yours can too.</p></div><Button asChild size="lg"><Link href="/docs/getting-started">Get started<Arrow /></Link></Button></section>
  </>;
}
