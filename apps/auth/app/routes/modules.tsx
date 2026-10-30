import { redirect, type LoaderContext, type PageProps } from "optz";
import { TrendChart } from "@optz/analytics/view";
import { administrator, analytics, status } from "$lib/modules.server";
import { getAuth } from "$lib/auth.server";
export const config = { render: "dynamic" } as const;
export const head = () => ({ title: "Module administration · OPTZ", robots: "noindex" });
export async function loader({ request }: LoaderContext) {
  if (!await getAuth().getSession(request!)) throw redirect("/login");
  if (!await administrator(request!)) throw new Response("A verified, explicitly configured administrator is required", { status: 403 });
  const now = Date.now();
  return { snapshot: await status().snapshot(), analyticsEnabled: !!process.env.ANALYTICS_HASH_SECRET, points: process.env.ANALYTICS_HASH_SECRET ? await analytics().trends("page_viewed", now - 7 * 86400000, now) : [] };
}
export default function Modules({ data }: PageProps<Awaited<ReturnType<typeof loader>>>) {
  return <><h1>Optional modules</h1><p>These forms and charts work without JavaScript. Only a verified account selected by MODULES_ADMIN_USER_ID can change public status or read insights.</p>
    <section><h2>Update a component</h2><form method="post" action="/api/status/components"><label>Stable component ID<input name="id" required maxLength={64} placeholder="api" /></label><label>Public name<input name="name" required maxLength={120} /></label><label>Status<select name="status"><option>operational</option><option>degraded</option><option>outage</option><option>maintenance</option></select></label><button>Save component</button></form></section>
    <section><h2>Report an incident</h2><form method="post" action="/api/status/incidents"><label>Public title<input name="title" required maxLength={160} /></label><label>Public update<textarea name="message" required maxLength={2000} /></label><input type="hidden" name="status" value="investigating" /><button>Create incident</button></form></section>
    {data.snapshot.incidents.filter(i => i.status !== "resolved").map(i => <section key={i.id}><h2>{i.title}</h2><form method="post" action={`/api/status/incidents/${i.id}`}><label>Public update<textarea name="message" required maxLength={2000} /></label><label>Stage<select name="status"><option>identified</option><option>monitoring</option><option>resolved</option></select></label><button>Publish update</button></form></section>)}
    {data.analyticsEnabled ? <TrendChart points={data.points} title="Consented page views · last seven days" /> : <p>Set ANALYTICS_HASH_SECRET to enable the analytics example.</p>}
  </>;
}
