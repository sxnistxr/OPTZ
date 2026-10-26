"use client";

import { useState } from "react";
import type { Post } from "$lib/social";
import { Compose } from "./Compose";
import Feed from "./Feed";
import { TokenPanel } from "./TokenPanel";

/** Island: token, compose box and feed share state, so they hydrate as one. */
export default function Social() {
  const [mine, setMine] = useState<Post[]>([]);
  return (
    <>
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
