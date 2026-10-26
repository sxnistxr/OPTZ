import type { OgProps } from "optz/og";
import { formatDate } from "$lib/format";
import { OgCard } from "$lib/og-card";
import type { Post } from "$lib/posts";

export default function PostCard({ data: post }: OgProps<Post>) {
  return <OgCard kicker="Writing" title={post.title} footer={formatDate(post.date)} />;
}
