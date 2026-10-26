import type { Head } from "optz";
import Social from "$components/Social.island";

export const head = (): Head => ({ title: "Feed | social demo", description: "A small social network on the Rust engine." });

export default function SocialPage() {
  return (
    <>
      <h1 className="text-4xl font-semibold tracking-[-0.02em] md:text-5xl">Feed</h1>
      <p className="mt-4 max-w-[36rem] text-muted">
        A small social network on the Rust engine from the $12 Server Challenge. Anyone can read it. Posting and liking need a token
        (on the server: <code>sudo python3 ops/mint-token.py NAME</code>).
      </p>
      <Social />
    </>
  );
}
