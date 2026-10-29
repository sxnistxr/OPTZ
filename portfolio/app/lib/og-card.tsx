// The Open Graph card every page shares: rendered to PNG at build time, in the site's palette.
// Inline styles and flexbox only (satori).
import site from "./site";

export function OgCard({ kicker, title, footer }: { kicker?: string; title: string; footer?: string }) {
  return (
    <div style={{ display: "flex", width: 1200, height: 630, background: "#f5f5f5", color: "#161616", fontFamily: "Schibsted Grotesk" }}>
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", flexGrow: 1, margin: 80 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18, fontSize: 30, color: "#666666" }}>
          <div style={{ width: 16, height: 16, borderRadius: 8, background: "#ffe46a" }} />
          {kicker ? `${site.name} ${kicker.toLowerCase()}` : site.name}
        </div>
        <div style={{ display: "flex", fontSize: title.length > 40 ? 68 : 88, fontWeight: 600, letterSpacing: -2, lineHeight: 1.05 }}>{title}</div>
        <div style={{ display: "flex", fontSize: 28, color: "#666666" }}>{footer ?? site.tagline}</div>
      </div>
    </div>
  );
}
