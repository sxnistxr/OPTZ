import type { StatusSnapshot } from "./index";
/** Pure server-renderable markup. No island, polling, charting dependency, CSS or browser SDK. */
export function StatusPage({ snapshot, title = "Service status" }: { snapshot: StatusSnapshot; title?: string }) {
  const states: Record<string, string> = { operational: "Operational", degraded: "Degraded", outage: "Outage", maintenance: "Maintenance", investigating: "Investigating", identified: "Identified", monitoring: "Monitoring", resolved: "Resolved" };
  return <section aria-label={title} className="optz-status">
    <h1>{title}</h1>
    {snapshot.components.length ? <ul aria-label="Components" className="optz-status-components">{snapshot.components.map(component => <li key={component.id}><strong>{component.name}</strong> <span className="optz-status-state" data-state={component.status}>{states[component.status]}</span></li>)}</ul> : <p>No components configured.</p>}
    <h2>Incidents</h2>
    {!snapshot.incidents.length && <p>No incidents reported.</p>}
    {snapshot.incidents.map(incident => <article key={incident.id}><h3>{incident.title}</h3><p>{states[incident.status]}</p><ol>{incident.updates.map((update, i) => <li key={i}><time dateTime={new Date(update.at).toISOString()}>{new Date(update.at).toISOString().replace("T", " ").slice(0, 16)} UTC</time><p><strong>{states[update.status]}</strong> {update.message}</p></li>)}</ol></article>)}
  </section>;
}
