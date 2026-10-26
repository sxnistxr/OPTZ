import type { OgProps } from "optz/og";
import type { Doc } from "$lib/docs";
import { OgCard } from "$lib/og-card";

export default function DocCard({ data: doc }: OgProps<Doc>) {
  return <OgCard kicker="Docs" title={doc.title} footer={doc.section} />;
}
