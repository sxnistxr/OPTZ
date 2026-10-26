import { useState } from "react";
import type { Head } from "optz";
import type { Post } from "$lib/api";
import { Compose } from "$lib/components/Compose";
import { Feed } from "$lib/components/Feed";
import { TokenPanel } from "$lib/components/TokenPanel";
import site from "$lib/site";

export const head = (): Head => ({ title: `Feed | ${site.title}`, description: "A small social network running on a $12 server." });

export default function Social() {
  const [mine, setMine] = useState<Post[]>([]);
  return (
    <>
      <h1 className="text-4xl font-semibold tracking-[-0.02em] md:text-5xl">Feed</h1>
      <p className="mt-4 max-w-[36rem] text-muted">
        A small social network running on the same $12 server as this site. Anyone can read it. Posting and liking need a token.
      </p>
      <section className="mt-10 max-w-[38rem]" aria-label="Your token">
        <TokenPanel />
      </section>
      <Compose onPosted={(p) => setMine((m) => [p, ...m])} />
      <section className="mt-12">
        <Feed limit={20} extra={mine} refreshable />
      </section>
    </>
  );
}
