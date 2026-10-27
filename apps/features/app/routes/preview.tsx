import type { LoaderContext, PageProps } from "optz";
import { locale } from "optz/server";

// Dynamic and cached: shared by everyone, except in draft mode, which renders per viewer.
export const config = { render: "dynamic" } as const;
export const cache = { maxAge: 60 };
export const loader = ({ draft }: LoaderContext) => ({ draft: !!draft, at: Date.now(), locale: locale() ?? null });

export default function Preview({ data }: PageProps<{ draft: boolean; at: number; locale: string | null }>) {
  return <p data-testid="preview">{data.draft ? `draft preview ${data.at}` : `published ${data.at}`}</p>;
}
