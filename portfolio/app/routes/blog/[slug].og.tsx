import type { OgProps } from "optz/og";
import { formatDate } from "$lib/format";
import type { Post } from "$lib/posts";
import site from "$lib/site";

// The card social networks show for a post: rendered to PNG at build time, in the site's palette.
export default function PostCard({ data: post }: OgProps<Post>) {
  return (
    <div style={{ display: "flex", width: 1200, height: 630, background: "#eef1f4", color: "#1b2433", fontFamily: "Schibsted Grotesk" }}>
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", flexGrow: 1, margin: 80 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18, fontSize: 30, color: "#5b6878" }}>
          <div style={{ width: 16, height: 16, borderRadius: 8, background: "#e8a33d" }} />
          {site.name}
        </div>
        <div style={{ display: "flex", fontSize: post.title.length > 40 ? 68 : 84, fontWeight: 600, letterSpacing: -2, lineHeight: 1.05 }}>{post.title}</div>
        <div style={{ display: "flex", fontSize: 28, color: "#5b6878" }}>{formatDate(post.date)}</div>
      </div>
    </div>
  );
}
