export function createAnalyticsClient(options: { endpoint: string; events: readonly string[] }) {
  const endpoint = new URL(options.endpoint, location.href);
  if (endpoint.origin !== location.origin) throw new TypeError("Use a same-origin analytics ingestion endpoint");
  let consent = false;
  let subject: string = crypto.randomUUID();
  const denied = () => navigator.doNotTrack === "1" || (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true;
  const capture = async (event: string, properties: Record<string, string | number | boolean> = {}) => {
    if (!consent || denied() || !options.events.includes(event)) return false;
    try { const response = await fetch(endpoint, { method: "POST", credentials: "omit", keepalive: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ consent: true, subject, event, properties }) }); return response.ok; } catch { return false; }
  };
  return {
    capture,
    setConsent(value: boolean) { consent = value === true; if (!consent) subject = crypto.randomUUID(); },
    identify(opaqueId: string) { if (!consent || denied()) return; if (!/^[a-zA-Z0-9_-]{8,128}$/.test(opaqueId)) throw new TypeError("Use an opaque analytics ID"); subject = opaqueId; },
    /** Opt-in only; captures explicit data attributes, never text, forms or URLs. Returns cleanup. */
    clicks(root: Document | HTMLElement = document) {
      const listener = (event: Event) => { const target = event.target instanceof Element ? event.target.closest("[data-analytics-event]") : null; if (target) void capture(target.getAttribute("data-analytics-event")!); };
      root.addEventListener("click", listener); return () => root.removeEventListener("click", listener);
    },
    /** Caller supplies a safe route pattern; query strings and actual dynamic IDs are never read. */
    page(event: string, routeProperty: string) { return capture(event, { route: routeProperty }); },
  };
}
