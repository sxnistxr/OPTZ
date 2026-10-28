import { Link, type Href } from "optz";
import type { Experiment } from "$lib/lab";

const label = { exploring: "Exploring", shipped: "Shipped", paused: "Paused" };

/** The lab's experiments as a list: what each one is, and where it stands. */
export function LabList({ items, detail = false }: { items: Experiment[]; detail?: boolean }) {
  return (
    <ol className="lab-list">
      {items.map((x) => (
        <li key={x.slug} id={x.slug} className="lab-item">
          <div>
            <h3 className="lab-title">
              {x.href ? (
                <Link href={x.href as Href} className="hover:underline hover:decoration-rule hover:underline-offset-4">
                  {x.name}
                </Link>
              ) : (
                x.name
              )}
            </h3>
            <p className="lab-summary">{x.summary}</p>
            {detail && x.notes && <p className="mt-2 text-sm text-muted">{x.notes}</p>}
          </div>
          <div className="lab-meta">
            <span className="lab-area">{x.area}</span>
            <span className="lab-status">
              <span className="status-dot" data-status={x.status} />
              {label[x.status]}
            </span>
          </div>
        </li>
      ))}
    </ol>
  );
}
