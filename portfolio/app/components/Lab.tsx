import { Link, type Href } from "optz";
import type { Experiment } from "$lib/lab";

const label = { exploring: "Exploring", shipped: "Shipped", paused: "Paused" };

/** The lab's experiments as a list: what each one is, and where it stands. */
export function LabList({ items, detail = false }: { items: Experiment[]; detail?: boolean }) {
  return (
    <ol className="divide-y divide-rule border-y border-rule">
      {items.map((x) => (
        <li key={x.slug} id={x.slug} className="grid gap-x-8 gap-y-1 py-6 sm:grid-cols-[11rem_minmax(0,1fr)]">
          <div className="text-sm text-muted">
            <span className="block">{x.area}</span>
            <span className="mt-1 inline-flex items-center gap-2">
              <span className="status-dot" data-status={x.status} />
              {label[x.status]}
            </span>
          </div>
          <div>
            <h3 className="text-lg font-semibold leading-snug tracking-tight">
              {x.href ? (
                <Link href={x.href as Href} className="hover:underline hover:decoration-rule hover:underline-offset-4">
                  {x.name}
                </Link>
              ) : (
                x.name
              )}
            </h3>
            <p className="mt-1 max-w-[38rem] leading-relaxed">{x.summary}</p>
            {detail && x.notes && <p className="mt-2 text-sm text-muted">{x.notes}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}
