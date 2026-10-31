/**
 * Line illustrations for the OPTZ page. Drawn with theme tokens (classes in styles.css), so they follow
 * light and dark mode, and decorative: the heading beside each one says what it shows.
 */

/** Pages are rendered once, then kept as ready responses: the HTML and its compressed copies. */
export function PrebuiltIllustration() {
  const cards = [
    { x: 236, y: 38, label: "page.html.gz" },
    { x: 168, y: 94, label: "page.html.br" },
    { x: 100, y: 150, label: "page.html", front: true },
  ];
  return <svg className="illustration" viewBox="0 0 480 320" aria-hidden="true">
    {cards.map((c) => <g key={c.label}>
      <rect className={c.front ? "ill-card ill-card-front" : "ill-card"} x={c.x} y={c.y} width="190" height="130" rx="5" />
      <text className={c.front ? "ill-label ill-label-ink" : "ill-label"} x={c.x + 176} y={c.y + 20} textAnchor="end">{c.label}</text>
      <rect className={c.front ? "ill-ink" : "ill-soft"} x={c.x + 16} y={c.y + 36} width="72" height="8" rx="2" />
      {c.front && [150, 128, 142].map((w, i) => <rect key={i} className="ill-soft" x={c.x + 16} y={c.y + 58 + i * 14} width={w} height="5" rx="2" />)}
    </g>)}
    {/* The response leaves already prepared: the streak of the OPTZ mark. */}
    <g className="ill-accent-stroke">
      <path d="M302 236h96" /><path d="M318 248h66" /><path d="M330 224h44" />
    </g>
  </svg>;
}

/** HTML by default: the page is static, and only the component marked as an island ships JavaScript. */
export function IslandsIllustration() {
  const blocks = [[172, 106, 108, 70], [288, 106, 108, 70], [172, 184, 108, 76]];
  return <svg className="illustration" viewBox="0 0 480 320" aria-hidden="true">
    <defs>
      <pattern id="ill-grid" width="24" height="24" patternUnits="userSpaceOnUse"><path d="M24 0H0v24" className="ill-gridline" /></pattern>
      <radialGradient id="ill-grid-fade"><stop offset=".35" stopColor="#fff" /><stop offset="1" stopColor="#fff" stopOpacity="0" /></radialGradient>
      <mask id="ill-grid-mask"><rect width="480" height="320" fill="url(#ill-grid-fade)" /></mask>
    </defs>
    <rect width="480" height="320" fill="url(#ill-grid)" mask="url(#ill-grid-mask)" />
    <rect className="ill-card" x="70" y="44" width="340" height="232" rx="7" />
    <path className="ill-rule" d="M70 68h340" />
    {[86, 96, 106].map((x) => <circle key={x} className="ill-soft" cx={x} cy="56" r="2.6" />)}
    <rect className="ill-soft" x="86" y="84" width="70" height="176" rx="3" />
    {[100, 116, 132].map((y) => <rect key={y} className="ill-card" x="96" y={y} width="44" height="5" rx="2" />)}
    <rect className="ill-soft" x="172" y="84" width="224" height="10" rx="2" />
    {blocks.map(([x, y, w, h]) => <rect key={`${x}${y}`} className="ill-soft" x={x} y={y} width={w} height={h} rx="3" />)}
    <rect className="ill-island" x="288" y="184" width="108" height="76" rx="4" />
    <circle className="ill-accent" cx="302" cy="198" r="3.5" />
    <text className="ill-label ill-label-ink" x="312" y="202">island</text>
    <rect className="ill-ink" x="300" y="234" width="46" height="14" rx="3" />
  </svg>;
}

/** Files become routes, and every link to them is checked against the route list. */
export function RoutesIllustration() {
  const files = [["index.tsx", "/"], ["blog/[slug].tsx", "/blog/:slug"], ["api/posts.ts", "/api/posts"]];
  return <svg className="illustration" viewBox="0 0 480 320" aria-hidden="true">
    <text className="ill-label ill-label-ink" x="62" y="74">app/routes</text>
    <path className="ill-rule" d="M70 84v124M70 120h14M70 170h14M70 220h14" />
    {files.map(([file, url], i) => {
      const y = 120 + i * 50, fileW = 18 + file.length * 6.6, urlW = 22 + url.length * 6.6, hot = i === 1;
      return <g key={file}>
        <rect className="ill-card" x="84" y={y - 13} width={fileW} height="26" rx="5" />
        <text className="ill-label ill-label-body" x="96" y={y + 4}>{file}</text>
        <path className={hot ? "ill-link-hot" : "ill-link"} d={`M${84 + fileW + 6} ${y}C${270} ${y} ${260} ${y} ${300} ${y}`} />
        <rect className={hot ? "ill-island" : "ill-card"} x="306" y={y - 13} width={urlW} height="26" rx="13" />
        <text className={hot ? "ill-label ill-label-ink" : "ill-label ill-label-body"} x="317" y={y + 4}>{url}</text>
      </g>;
    })}
    <circle className="ill-accent" cx="306" cy="170" r="3.5" />
  </svg>;
}
