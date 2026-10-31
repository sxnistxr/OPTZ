// Static counterpart of the site's hero: the same logos, type, palette, and trail curves.
// Inline styles and fixed dimensions keep the build-time Satori render deterministic.
import { cloneElement } from "react";
import DihLabsLogo from "$components/DihLabsLogo";
import OptzLogo from "$components/OptzLogo";
import { trailPath } from "./trail-geometry";
import site from "./site";

export function OgCard({ kicker, title, footer }: { kicker?: string; title: string; footer?: string }) {
  const product = kicker?.startsWith("OPTZ");
  const fontSize = title.length > 85 ? 54 : title.length > 55 ? 64 : title.length > 35 ? 76 : 96;
  const logo = cloneElement(product ? OptzLogo() : DihLabsLogo(), {
    width: product ? 214 : 215, height: product ? 40 : 42, fill: "#f4f4f5",
  });
  const section = product ? (kicker === "OPTZ" ? "React framework for Bun" : "Documentation") : kicker ?? site.tagline;
  return (
    <div style={{ display: "flex", position: "relative", width: 1200, height: 630, overflow: "hidden", background: "#0c0c0e", color: "#f4f4f5", fontFamily: "Schibsted Grotesk" }}>
      <svg width="1200" height="240" viewBox="0 0 1000 400" preserveAspectRatio="none" fill="none" style={{ position: "absolute", left: 0, top: 316 }}>
        {Array.from({ length: 36 }, (_, i) => <path key={i} d={trailPath(i / 35, 28, product ? 2.1 : 0)} stroke="#ffe46a" strokeOpacity={i % 4 === 0 ? 0.65 : 0.22} strokeWidth="0.9" />)}
      </svg>
      <div style={{ display: "flex", position: "absolute", top: 58, left: 72, width: 1056, alignItems: "center", justifyContent: "space-between" }}>
        {logo}
        <div style={{ display: "flex", fontSize: 24, color: "#a1a1aa" }}>{section}</div>
      </div>
      <div style={{ display: "flex", position: "absolute", top: 154, left: 72, width: 1056, height: 242, alignItems: "center" }}>
        <div style={{ display: "flex", fontSize, fontWeight: 600, letterSpacing: -fontSize * 0.045, lineHeight: 1.05 }}>{title}</div>
      </div>
      <div style={{ display: "flex", position: "absolute", left: 72, top: 548, width: 1056, alignItems: "center", justifyContent: "space-between", gap: 32, borderTop: "1px solid #29292e", paddingTop: 22, fontSize: 24, color: "#c8c8cd" }}>
        <div style={{ display: "flex", maxWidth: 810 }}>{footer ?? site.tagline}</div>
        <div style={{ display: "flex", color: "#a1a1aa" }}>{new URL(site.url).hostname}</div>
      </div>
    </div>
  );
}
