/** Server-only dashboard markup; the native meter needs no charting library or hydration. */
export function TrendChart({ points, title }: { points: { at: number; count: number }[]; title: string }) {
  const max = Math.max(1, ...points.map(p => p.count));
  return <section aria-label={title}><h2>{title}</h2>{!points.length ? <p>No events in this range.</p> : <table><thead><tr><th scope="col">Period (UTC)</th><th scope="col">Events</th><th scope="col">Relative count</th></tr></thead><tbody>{points.map(p => <tr key={p.at}><th scope="row"><time dateTime={new Date(p.at).toISOString()}>{new Date(p.at).toISOString().slice(0, 10)}</time></th><td>{p.count}</td><td><meter min={0} max={max} value={p.count}>{p.count}</meter></td></tr>)}</tbody></table>}</section>;
}
