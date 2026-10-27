import type { ReactNode } from "react";

// Parallel routes: @stats and @feed render next to the page, each from its own folder.
export default function Dashboard({ children, stats, feed }: { children: ReactNode; stats?: ReactNode; feed?: ReactNode }) {
  return (
    <div className="grid grid-cols-3 gap-4">
      <div>{children}</div>
      <aside aria-label="Stats" data-testid="stats-slot">
        {stats}
      </aside>
      <aside aria-label="Feed" data-testid="feed-slot">
        {feed}
      </aside>
    </div>
  );
}
