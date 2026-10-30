import type { AnalyticsAdapter } from "./index";
/** Inject the official posthog-node client; the SDK stays in the application that opts in. */
export function posthogAdapter(client: { capture(event: { distinctId: string; event: string; properties: Record<string, unknown>; timestamp: Date; disableGeoip: boolean }): unknown }): AnalyticsAdapter {
  return { capture(event) { client.capture({ distinctId: event.subject, event: event.event, properties: { ...event.properties, $process_person_profile: false }, timestamp: new Date(event.at), disableGeoip: true }); } };
}
