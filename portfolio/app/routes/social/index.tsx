import type { Head } from "optz";
import Social from "$components/Social.island";
import site from "$lib/site";

export const head = (): Head => ({ title: `Feed | ${site.title}`, description: "A small social network running on a $12 server." });

export default function SocialPage() {
  return (
    <>
      <h1 className="text-4xl font-semibold tracking-[-0.02em] md:text-5xl">Feed</h1>
      <p className="mt-4 max-w-[36rem] text-muted">
        A small social network running on the same $12 server as this site. Anyone can read it. Posting and liking need a token.
      </p>
      <Social />
    </>
  );
}
