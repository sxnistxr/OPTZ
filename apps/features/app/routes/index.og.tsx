import type { OgProps } from "optz/og";

// The home page's Open Graph image, rendered to PNG at build time.
export default function Og({ locale }: OgProps) {
  return (
    <div style={{ display: "flex", width: "100%", height: "100%", alignItems: "center", justifyContent: "center", background: "#14213d", color: "#fca311", fontSize: 96, fontWeight: 700 }}>
      {locale === "fr" ? "Fonctionnalités" : "optz features"}
    </div>
  );
}
