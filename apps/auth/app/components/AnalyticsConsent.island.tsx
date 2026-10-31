import { useEffect, useRef, useState } from "react";
import { createAnalyticsClient } from "@sxnistxr/optz-analytics/client";
export const hydrate = "idle";
export default function AnalyticsConsent() {
  const client = useRef<ReturnType<typeof createAnalyticsClient> | null>(null);
  const [allowed, setAllowed] = useState(false), [message, setMessage] = useState("Tracking is off.");
  useEffect(() => { client.current = createAnalyticsClient({ endpoint: "/api/analytics", events: ["page_viewed", "started", "completed"] }); return () => client.current?.setConsent(false); }, []);
  return <section><label><input type="checkbox" checked={allowed} onChange={e => { const value = e.currentTarget.checked; client.current?.setConsent(value); setAllowed(value); setMessage(value ? "Enabled for this page session. DNT and Global Privacy Control still take precedence." : "Tracking is off."); }} />Allow these example events for this page session</label><button disabled={!allowed} onClick={async () => setMessage(await client.current?.page("page_viewed", "/metrics-demo") ? "One consented event sent." : "No event sent; check consent, privacy preferences or server configuration.")}>Send a page-view event</button><p role="status">{message}</p></section>;
}
