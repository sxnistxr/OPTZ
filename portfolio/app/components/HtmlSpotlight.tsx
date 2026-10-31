import type { Post } from "$lib/posts";
import { formatDate } from "$lib/format";
import { binaryGrid, htmlBytes } from "$lib/html-bytes";
import HtmlSpotlightController from "$components/HtmlSpotlight.island";

const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

export function HtmlSpotlight({ post }: { post: Post }) {
  const source = `<article class="spotlight-post">\n  <time datetime="${escape(post.date)}">${escape(formatDate(post.date))}</time>\n  <h3>${escape(post.title)}</h3>\n${post.html}\n</article>`;
  return <figure className="html-demo">
    <div className="html-spotlight">
      <div className="spotlight-bar">
        <span className="window-dots" aria-hidden="true"><i /><i /><i /></span>
        <span className="spotlight-address">dihlabs.lol/blog/{post.slug}</span>
        <details className="spotlight-toggle">
          <summary aria-controls="spotlight-source"><span className="source-label">View source</span><span className="page-label">View page</span></summary>
        </details>
      </div>
      <div className="spotlight-viewport">
        <div className="spotlight-source" id="spotlight-source" role="region" aria-label="HTML source of the example post" tabIndex={0}>
          <pre><code>{source}</code></pre>
        </div>
        <pre className="spotlight-binary" aria-hidden="true">{binaryGrid(htmlBytes(source))}</pre>
        <div className="spotlight-rendered" dangerouslySetInnerHTML={{ __html: source }} />
        <HtmlSpotlightController />
      </div>
    </div>
    <figcaption><span>Move over the page to look underneath.</span><span>Page → bytes → HTML</span></figcaption>
  </figure>;
}
