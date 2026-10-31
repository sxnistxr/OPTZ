import type { ReactNode } from "react";

/**
 * Small, decorative previews of what each part of the docs builds: drawn in HTML so they follow the
 * theme and stay sharp. The card or heading beside each one says what it is; every name and
 * command shown here is a real one from the framework or its modules.
 */

export const learnChapters = ["Create your app", "Pages and layouts", "Load data", "Add interactivity", "Handle forms", "Add an API route", "Build and deploy"];

function Window({ bar, children, className = "" }: { bar: ReactNode; children: ReactNode; className?: string }) {
  return <div className={`preview-window ${className}`}><div className="preview-bar">{bar}</div><div className="preview-body">{children}</div></div>;
}

const Browser = ({ address }: { address: string }) => <><span className="preview-dots"><i /><i /><i /></span><span className="preview-address">{address}</span></>;
const Tabs = ({ path, file }: { path: string; file: string }) => <><span>{path}</span><span className="preview-tab-active">{file}</span></>;
const Tick = () => <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m3.5 8.5 3 3 6-7" /></svg>;

const previews = {
  quickstart: () => <Window bar={<span>Terminal</span>}>
      <p className="preview-command">bunx @sxnistxr/optz create my-app</p>
      <p className="preview-command">cd my-app</p>
      <p className="preview-command">bun add optz@npm:@sxnistxr/optz</p>
      <p className="preview-command">bun run dev</p>
      <p className="preview-ready"><Tick /><span>Ready at 127.0.0.1:3001</span></p>
  </Window>,
  learn: () => <Window bar={<span>Learn OPTZ</span>}>
    <ol className="preview-chapters">
      {learnChapters.slice(0, 4).map((chapter, i) => <li key={chapter} className={i < 2 ? "is-done" : i === 2 ? "is-current" : ""}><span className="preview-step">{i < 2 ? <Tick /> : i + 1}</span>{chapter}</li>)}
    </ol>
    <p className="preview-foot">Seven chapters, one working app</p>
  </Window>,
  framework: () => <Window bar={<Tabs path="my-app" file="app" />}>
    <ul className="preview-map">
      {[["routes/index.tsx", "/"], ["routes/books/[slug].tsx", "/books/:slug"], ["api/hello.ts", "/api/hello"], ["components/Counter.island.tsx", "island"]].map(([file, url]) => <li key={file}><code>{file}</code><span className="preview-arrow" /><code>{url}</code></li>)}
    </ul>
  </Window>,
  "full-stack": () => <Window bar={<Browser address="127.0.0.1:3001/notes" />}>
    <div className="preview-split">
      <div className="preview-side"><span className="is-active">Notes</span><span>Files</span><span>Sessions</span></div>
      <div>
        <p className="preview-heading">Private notes</p>
        <div className="preview-row"><span>Release checklist</span><small>Edited now</small></div>
        <div className="preview-row"><span>Ideas</span><small>2 files</small></div>
        <span className="preview-button">New note</span>
      </div>
    </div>
  </Window>,
  authentication: () => <Window bar={<Browser address="127.0.0.1:3001/sign-in" />}>
    <div className="preview-stack">
      <p className="preview-heading">Sign in</p>
      <span className="preview-button">Continue with a passkey</span>
      <span className="preview-button preview-button-outline">Continue with GitHub</span>
      <span className="preview-field">you@example.com</span>
      <small>Two-factor codes and recovery codes are optional.</small>
    </div>
  </Window>,
  deployment: () => <Window bar={<span>Ways to ship</span>}>
    <ul className="preview-list">
      {[["Bun server", "bun run start"], ["One executable", "bun run build --compile"], ["Edge worker", "bun run build --target edge"], ["Static files", "bunx optz export"]].map(([name, command]) => <li key={name}><span>{name}</span><code>{command}</code></li>)}
    </ul>
  </Window>,
  ai: () => <Window bar={<Browser address="dihlabs.lol/mcp" />}>
    <div className="preview-stack">
      <p className="preview-label"><span className="preview-dot" />Connected over MCP</p>
      {["search_pages", "read_page", "lab_experiments"].map((tool) => <div key={tool} className="preview-row"><code>{tool}</code><small>tool</small></div>)}
      <div className="preview-row"><code>build_with_optz</code><small>prompt</small></div>
    </div>
  </Window>,
  doppler: () => <Window bar={<Tabs path="my-app" file="optz.env.json" />}>
    <ul className="preview-list">
      {[["PUBLIC_URL", "url", true], ["DATABASE_PATH", "string", true], ["S3_BUCKET", "string", false]].map(([name, type, ok]) => <li key={String(name)}><code>{name}</code><small>{type}</small><span className={ok ? "preview-ok" : "preview-missing"}>{ok ? "Set" : "Missing"}</span></li>)}
    </ul>
    <p className="preview-foot">Doppler config: dev_personal</p>
  </Window>,
  uploads: () => <Window bar={<Browser address="127.0.0.1:3001/files" />}>
    <div className="preview-stack">
      <div className="preview-row"><span>site-photos.zip</span><small>Part 3 of 8</small></div>
      <div className="preview-parts">{Array.from({ length: 8 }, (_, i) => <i key={i} className={i < 3 ? "is-done" : i === 3 ? "is-active" : ""} />)}</div>
      <p className="preview-label"><Tick />Checksums verified for 3 parts</p>
      <div className="preview-row"><small>Your storage</small><small>412 MB of 1 GB</small></div>
      <div className="preview-meter"><i /></div>
    </div>
  </Window>,
  "status-pages": () => <Window bar={<Browser address="status.example.com" />}>
    <div className="preview-stack">
      {[["API", "Operational"], ["Uploads", "Degraded"], ["Website", "Operational"]].map(([name, state]) => <div key={name} className="preview-row"><span>{name}</span><span className={`preview-state is-${state.toLowerCase()}`}>{state}</span></div>)}
      <p className="preview-label">Elevated upload errors</p>
      <ol className="preview-stages">{["Investigating", "Identified", "Monitoring", "Resolved"].map((stage, i) => <li key={stage} className={i < 3 ? "is-done" : ""}>{stage}</li>)}</ol>
    </div>
  </Window>,
  analytics: () => <Window bar={<Tabs path="insights" file="funnel" />}>
    <div className="preview-stack">
      {[["page_viewed", 100], ["started", 42], ["completed", 18]].map(([event, share]) => <div key={event} className="preview-bar-row"><code>{event}</code><span className={`preview-bar-fill is-${share}`} /><small>{share}%</small></div>)}
      <div className="preview-consent"><span>Share anonymous usage?</span><span className="preview-button">Allow</span><span className="preview-button preview-button-outline">No thanks</span></div>
    </div>
  </Window>,
  databases: () => <Window bar={<Tabs path="app/lib" file="sessions.server.ts" />}>
    <p className="preview-label"><code>createSessions()</code></p>
    <p className="preview-store">SessionStore</p>
    <div className="preview-chips">{["Prisma", "Drizzle", "Kysely", "TypeORM", "SQL"].map((name) => <span key={name}>{name}</span>)}</div>
  </Window>,
  cloudflare: () => <Window bar={<Tabs path="app/actions" file="posts.ts" />}>
    <ol className="preview-flow">
      <li><code>revalidateTag("posts")</code><small>after you save</small></li>
      <li><span>OPTZ cache</span><small>stale copy replaced</small></li>
      <li><span>Cloudflare</span><small>purge by tag</small></li>
    </ol>
  </Window>,
} satisfies Record<string, () => ReactNode>;

export type PreviewName = keyof typeof previews;

/** Which docs pages open with a preview. */
export const pagePreviews: Partial<Record<string, PreviewName>> = {
  "getting-started": "quickstart", framework: "framework", "full-stack": "full-stack", authentication: "authentication", deployment: "deployment", ai: "ai",
  doppler: "doppler", uploads: "uploads", "status-pages": "status-pages", analytics: "analytics", databases: "databases", cloudflare: "cloudflare",
};

export function DocPreview({ name }: { name: PreviewName }) {
  const Preview = previews[name];
  return <div className={`preview-plate preview-${name}`} aria-hidden="true"><Preview /></div>;
}
