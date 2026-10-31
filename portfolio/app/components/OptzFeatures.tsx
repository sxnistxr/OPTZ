import { Link, type Href } from "optz";
import { Arrow } from "$components/Icons";
import { highlightCode } from "$lib/docs-syntax";
import { hexRows, preparedFiles } from "$lib/prepared-files";
import BuildFiles from "$components/BuildFiles.island";
import Counter from "$components/Counter.island";

const HELLO_HTML = '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>Hello</title>\n</head>\n<body>\n<h1>Hello, your next idea.</h1>\n</body>\n</html>\n';

/** The /hello page and its compressed copies, made at build time with the same settings as `optz build`. */
const helloFiles = preparedFiles(HELLO_HTML).map(({ name, encoding, bytes }) =>
  encoding === "identity" ? { name, encoding, code: highlightCode(HELLO_HTML.trimEnd(), "html") } : { name, encoding, bytes: [hexRows(bytes, 16), hexRows(bytes, 10)] as [string, string] });

function Check() {
  return <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true"><path d="m3 8 3 3 7-7" /></svg>;
}

export function FeatureCode({ code, language = "tsx" }: { code: string; language?: string }) {
  return <pre className="prose-docs feature-code"><code dangerouslySetInnerHTML={{ __html: highlightCode(code, language) }} /></pre>;
}

const details: {title: string; text: string; href: Href; icon: string}[] = [
  { title: "Server Actions", text: "Call server code from a form or a button. Forms still submit with JavaScript turned off.", href: "/docs/framework#server-actions", icon: "M4 6h16M4 12h10M4 18h10m3-3 3 3-3 3" },
  { title: "Streaming", text: "Send the page shell first. Let slower parts arrive as they’re ready, with loading states in place.", href: "/docs/framework#streaming-and-async-components", icon: "M4 5h16M4 12h12M4 19h7m6-3 3 3-3 3" },
  { title: "Incremental regeneration", text: "Keep a static page fresh in the background, on a timer or with a revalidation call.", href: "/docs/framework#incremental-static-regeneration", icon: "M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-2l2 2M4 17l2 2a7 7 0 0 0 12-2" },
  { title: "Client navigation", text: "Prefetch on hover and swap page HTML in place. Interactive islands keep their state.", href: "/docs/framework#islands-the-payload-optimization", icon: "M3 12h18m-6-6 6 6-6 6M3 5v14" },
  { title: "Fonts and images", text: "Serve fonts from your domain and generate responsive image sizes when they’re requested.", href: "/docs/framework#metadata-images-fonts-scripts", icon: "M4 4h16v16H4zM4 16l5-5 4 4 3-3 4 4M14 8h.01" },
  { title: "Choose where it runs", text: "A Bun server, a static export, an executable, or an edge worker. Pick the target your app needs.", href: "/docs/deployment", icon: "M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5" },
];

function NotesPreview() {
  return <div className="optz-artwork" aria-hidden="true">
    <img className="artwork-light" src="/images/optz/notes-preview-light.webp" width={1100} height={760} alt="" loading="lazy" decoding="async" />
    <img className="artwork-dark" src="/images/optz/notes-preview-dark.webp" width={1100} height={760} alt="" loading="lazy" decoding="async" />
  </div>;
}

export function OptzFeatures() {
  return <section className="content-section site-container optz-features" aria-labelledby="features-title">
    <div className="product-section-intro"><h2 id="features-title">A little framework.<br />A lot of possibility.</h2><p>Start with a page. Add interaction, data, and everything your next idea needs.</p></div>
    <div className="product-bento">
      <article className="product-card product-card-pages">
        <div className="product-card-copy"><h3>Ready before the request.</h3><p>Your pages, rendered and compressed at build time. When someone visits, the response is already waiting.</p><Link href="/docs/architecture" className="text-link">How it works<Arrow /></Link></div>
        <div className="product-workspace build-workspace" role="group" aria-label="Example build output"><BuildFiles files={helloFiles} /></div>
      </article>
      <article className="product-card product-card-islands">
        <div className="product-card-copy"><h3>A little JavaScript.<br />Exactly where it belongs.</h3><p>Only the components you mark as islands hydrate. Everything around them stays HTML.</p><Link href="/docs/framework#islands-the-payload-optimization" className="text-link">Explore islands<Arrow /></Link></div>
        <div className="product-workspace island-browser" role="group" aria-label="Example page with one island">
          <div className="browser-bar"><span className="browser-dots" aria-hidden="true"><i /><i /><i /></span><span className="browser-address">localhost:3000/hello</span></div>
          <div className="island-page">
            <strong>Hello, your next idea.</strong>
            <p>A small page, ready before anyone asked for it.</p>
            <Counter start={3} />
            <p className="island-page-after">Write one down and see where it goes.</p>
          </div>
        </div>
      </article>
      <article className="product-card product-card-routes">
        <div className="product-card-copy"><h3>From a file to a working page.</h3><p>Routes, layouts, and APIs follow your files. Types connect the pieces as you build.</p><Link href="/docs/framework#pages-approutes" className="text-link">Find your way around<Arrow /></Link></div>
        <div className="product-workspace" aria-label="Example typed route">
          <div className="workspace-tabs"><span>app / routes</span><span>hello.tsx</span></div>
          <FeatureCode code={'export default function Hello() {\n  return (\n    <h1>Hello, your next idea.</h1>\n  );\n}'} />
          <div className="workspace-output"><span>/hello</span><strong>Hello, your next idea.</strong><span className="workspace-check"><Check />Types checked. Ready to serve.</span></div>
        </div>
      </article>
      <article className="product-card product-card-fullstack">
        <div className="product-card-copy"><h3>Room for the whole application.</h3><p>Accounts, SQLite, private notes, and live updates. Start with a working full-stack app and make it yours.</p><Link href="/docs/full-stack" className="text-link">Meet the full-stack starter<Arrow /></Link></div>
        <div className="product-app-preview"><NotesPreview /></div>
        <p className="product-preview-caption">Example notes workspace</p>
      </article>
    </div>
    <div className="framework-detail-grid">
      {details.map(item => <article key={item.title}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={item.icon} /></svg><h3><Link href={item.href}>{item.title}<Arrow /></Link></h3><p>{item.text}</p></article>)}
    </div>
  </section>;
}
