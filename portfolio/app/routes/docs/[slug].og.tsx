import type { OgProps } from "optz/og";
import type { Doc } from "$lib/docs";
import { OgCard } from "$lib/og-card";

export default function DocCard({ data: doc }: OgProps<Doc>) {
  return <OgCard kicker="OPTZ docs" title={doc.title} footer={doc.section} />;
}
