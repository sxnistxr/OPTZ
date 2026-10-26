import type { Head, PageProps } from "optz";

const text = { en: "Hello", fr: "Bonjour" } as Record<string, string>;
export const head = (_: unknown, { locale }: { locale?: string }): Head => ({
  title: locale === "fr" ? "Fonctionnalités" : "Features",
  canonical: "/",
  openGraph: { siteName: "optz" },
});

export default function Home({ locale }: PageProps) {
  return <h1 className="text-3xl font-bold">{text[locale ?? "en"]}</h1>;
}
