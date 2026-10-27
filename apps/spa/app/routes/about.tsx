import type { Head, PageProps } from "optz";
import { Script } from "optz/script";

export const head = (_: unknown, { locale }: { locale?: string }): Head => ({
  title: locale === "fr" ? "À propos" : "About",
  description: "About the SPA fixture.",
  robots: { index: false },
  canonical: "/about",
  openGraph: { title: "About (OG)" },
});

export default function About({ locale }: PageProps) {
  return (
    <>
      <h1>{locale === "fr" ? "À propos" : "About"}</h1>
      <Script src="/marker.js" />
    </>
  );
}
