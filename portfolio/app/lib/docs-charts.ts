// Build-time visualizations: values come from checked-in benchmark evidence, never estimates.
import network from "../../../bench/results.json";
import dispatch from "../../../bench/fullstack-results.json";

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const repo = "https://github.com/sxnistxr/OPTZ/blob/main/";
type Row = { label: string; values: [number, number] };
type Plot = { title: string; unit: string; series: [string, string]; rows: Row[]; ceiling?: number; kind?: "line" };
const number = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: v < 10 ? 2 : v < 100 ? 1 : 0 });

function bars(plot: Plot) {
  const max = plot.ceiling ?? Math.max(...plot.rows.flatMap(r => r.values));
  const left = 150, width = 420, rowHeight = 82, height = plot.rows.length * rowHeight + 56;
  const ticks = [0, .25, .5, .75, 1].map(t => {
    const x = left + t * width;
    return `<line class="chart-gridline" x1="${x}" x2="${x}" y1="18" y2="${height - 28}"/><text class="chart-axis" x="${x}" y="${height - 8}" text-anchor="middle">${number(max * t)}</text>`;
  }).join("");
  const rows = plot.rows.map((row, i) => {
    const y = 27 + i * rowHeight;
    return `<text class="chart-label" x="0" y="${y + 19}">${esc(row.label)}</text>` + row.values.map((v, j) => {
      const size = v / max * width;
      return `<rect class="chart-series-${j}" x="${left}" y="${y + j * 26}" width="${size.toFixed(3)}" height="16" rx="2"/><text class="chart-value" x="${left + size + 6}" y="${y + j * 26 + 12}">${number(v)}</text>`;
    }).join("");
  }).join("");
  return `<section class="chart-panel"><h3>${esc(plot.title)}</h3><p class="chart-unit">${esc(plot.unit)}</p><div class="chart-legend">${plot.series.map((s, i) => `<span><i class="chart-series-${i}"></i>${esc(s)}</span>`).join("")}</div><div class="chart-plot" tabindex="0" role="region" aria-label="${esc(plot.title)} chart; scroll horizontally on small screens"><svg viewBox="0 0 640 ${height}" aria-hidden="true">${ticks}${rows}</svg></div><details class="chart-data"><summary>View exact values</summary><div class="table-scroll"><table><caption>${esc(plot.title)} (${esc(plot.unit)})</caption><thead><tr><th scope="col">Case</th>${plot.series.map(s => `<th scope="col">${esc(s)}</th>`).join("")}</tr></thead><tbody>${plot.rows.map(r => `<tr><th scope="row">${esc(r.label)}</th>${r.values.map(v => `<td>${v.toLocaleString("en-US", { maximumFractionDigits: 3 })}</td>`).join("")}</tr>`).join("")}</tbody></table></div></details></section>`;
}

export function renderDocsChart(id: string): string | undefined {
  const paths = Object.keys(network.optz.paths) as (keyof typeof network.optz.paths)[];
  const plots: Record<string, { plots: Plot[]; note: string; source: string }> = {
    throughput: {
      plots: [{ title: "Static response throughput", unit: "Requests / second · higher is better", series: ["OPTZ", "Next.js 16"], ceiling: 30000,
        rows: paths.map(path => ({ label: path.startsWith("/blog/") ? "/blog/<slug>" : path, values: [network.optz.paths[path].rps.median, network.next.paths[path].rps.median] })) }],
      note: "Measured October 27, 2026 on the historical portfolio build. One pinned CPU core, 64 connections, median of three 10-second runs. Linear scale starts at zero. These are cached/static responses, not full-stack application results.", source: "bench/results.json",
    },
    resources: {
      plots: [
        { title: "Build time", unit: "Seconds · lower is better", series: ["OPTZ", "Next.js 16"], rows: [{ label: "Warm font cache", values: [network.build_s.optz.median, network.build_s.next.median] }] },
        { title: "Process memory", unit: "MiB RSS · lower is better", series: ["OPTZ", "Next.js 16"], rows: [{ label: "Idle", values: [network.optz.idle_rss_kib / 1024, network.next.idle_rss_kib / 1024] }, { label: "Peak under load", values: [network.optz.peak_rss_kib / 1024, network.next.peak_rss_kib / 1024] }] },
        { title: "Blog JavaScript", unit: "KiB transferred · lower is better", series: ["OPTZ", "Next.js 16"], rows: [{ label: "/blog/<slug>", values: [network.optz.js["/blog/a-close-that-never-closed"].transferred / 1024, network.next.js["/blog/a-close-that-never-closed"].transferred / 1024] }] },
      ], note: "Historical October 27, 2026 build; not a payload audit of the redesigned site. Each panel has its own zero-based linear scale and unit. Memory and transfer sizes use binary units.", source: "bench/results.json",
    },
    dispatch: {
      plots: [{ title: "Static dispatch as the route table grows", unit: "Microseconds / operation · lower is better", series: ["Previous handler", "Indexed handler"], rows: dispatch.serving.map(r => ({ label: `${r.routes} routes · ${r.middleware ? "1 header" : "no middleware"}`, values: [r.before_ns / 1000, r.after_ns / 1000] })) }],
      note: "Measured October 28, 2026, Bun 1.4.4, AMD EPYC 9V45. Five warmed, interleaved samples; medians shown. Last static route in the manifest. Dirty working tree recorded in source. In-process dispatch only: no network, database, SSR or production tail latency claim.", source: "bench/fullstack-results.json",
    },
    matching: {
      plots: [{ title: "Route matching cost", unit: "Microseconds / lookup · lower is better", kind: "line", series: ["Linear scan", "Indexed lookup"], rows: dispatch.matching.map(r => ({ label: String(r.routes), values: [r.linear_ns / 1000, r.indexed_ns / 1000] })) }],
      note: "Same October 28 fixture, route matcher only. Both axes are linear and start at zero; points are measured at 10, 100 and 1,000 routes. Lines connect samples and do not predict intermediate results. The indexed series stays near zero at this scale; exact measurements are available below.", source: "bench/fullstack-results.json",
    },
  };
  const chart = plots[id];
  if (!chart) return;
  return `<figure class="docs-chart">${chart.plots.map(p => p.kind === "line" ? line(p) : bars(p)).join("")}<figcaption>${esc(chart.note)} <a href="${repo}${chart.source}">Raw data and provenance</a>.</figcaption></figure>`;
}

function line(plot: Plot) {
  const x = (v: number) => 55 + v / 1000 * 510;
  const y = (v: number) => 250 - v / 60 * 220;
  const grid = [0, 20, 40, 60].map(v => `<line class="chart-gridline" x1="55" x2="565" y1="${y(v)}" y2="${y(v)}"/><text class="chart-axis" x="43" y="${y(v) + 4}" text-anchor="end">${v}</text>`).join("")
    + [0, 100, 500, 1000].map(v => `<text class="chart-axis" x="${x(v)}" y="275" text-anchor="middle">${number(v)}</text>`).join("");
  const series = plot.series.map((_, i) => `<polyline class="chart-line-${i}" points="${plot.rows.map(r => `${x(Number(r.label))},${y(r.values[i])}`).join(" ")}"/>${plot.rows.map(r => `<circle class="chart-point-${i}" cx="${x(Number(r.label))}" cy="${y(r.values[i])}" r="4"/>`).join("")}`).join("");
  return `<section class="chart-panel"><h3>${esc(plot.title)}</h3><p class="chart-unit">${esc(plot.unit)}</p><div class="chart-legend">${plot.series.map((s, i) => `<span><i class="chart-series-${i}"></i>${esc(s)}</span>`).join("")}</div><div class="chart-plot" tabindex="0" role="region" aria-label="Route matching chart; scroll horizontally on small screens"><svg viewBox="0 0 640 310" aria-hidden="true">${grid}${series}<text class="chart-axis" x="310" y="303" text-anchor="middle">Number of routes</text></svg></div><details class="chart-data"><summary>View exact values</summary><div class="table-scroll"><table><caption>Route matching (microseconds / lookup)</caption><thead><tr><th scope="col">Routes</th>${plot.series.map(s => `<th scope="col">${esc(s)}</th>`).join("")}</tr></thead><tbody>${plot.rows.map(r => `<tr><th scope="row">${r.label}</th>${r.values.map(v => `<td>${v.toFixed(3)}</td>`).join("")}</tr>`).join("")}</tbody></table></div></details></section>`;
}
