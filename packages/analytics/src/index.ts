import { createHmac } from "node:crypto";
import { assertSameOrigin, createRateLimiter } from "optz/security";
import { parseInput, ValidationError } from "optz/forms";
export type EventSchema = Record<string, Record<string, "number" | "boolean" | readonly string[]>>;
export interface AnalyticsEvent { event: string; subject: string; properties: Record<string, string | number | boolean>; at: number }
export interface AnalyticsStore {
  append(event: AnalyticsEvent): void | Promise<void>;
  scan(from: number, to: number): AnalyticsEvent[] | Promise<AnalyticsEvent[]>;
  exportSubject(subject: string): AnalyticsEvent[] | Promise<AnalyticsEvent[]>;
  deleteSubject(subject: string): void | Promise<void>;
  prune(before: number): void | Promise<void>;
}
export interface AnalyticsAdapter { capture(event: AnalyticsEvent): void | Promise<void> }
export function createAnalytics(options: { store: AnalyticsStore; events: EventSchema; secret: string; origin: string; retentionDays?: number; requestsPerMinute?: number; adapters?: AnalyticsAdapter[]; onAdapterError?: () => void }) {
  if (options.secret.length < 32) throw new TypeError("Analytics hashing secret must be at least 32 characters");
  const retention = options.retentionDays ?? 30;
  if (!Number.isSafeInteger(retention) || retention < 1 || retention > 365) throw new TypeError("Invalid analytics retention");
  for (const [event, fields] of Object.entries(options.events)) {
    if (!/^[a-zA-Z][a-zA-Z0-9_.$-]{0,79}$/.test(event) || !fields || typeof fields !== "object") throw new TypeError("Invalid analytics event schema");
    for (const [key, rule] of Object.entries(fields)) if (!/^[a-zA-Z][a-zA-Z0-9_]{0,49}$/.test(key) || /email|password|token|secret|phone|address|ip_address/i.test(key) || (rule !== "number" && rule !== "boolean" && (!Array.isArray(rule) || !rule.length || rule.length > 100 || rule.some(v => typeof v !== "string" || v.length > 100)))) throw new TypeError("Use numeric, boolean or enumerated analytics properties without personal fields");
  }
  const hash = (subject: string) => {
    if (!/^[a-zA-Z0-9_-]{8,128}$/.test(subject)) throw new TypeError("Use an opaque analytics subject identifier");
    return createHmac("sha256", options.secret).update(subject).digest("hex");
  };
  const budget = createRateLimiter({ limit: options.requestsPerMinute ?? 1000, windowMs: 60000, maxKeys: 1 });
  let nextPrune = 0;
  async function capture(event: string, subject: string, properties: Record<string, unknown> = {}) {
    if (!Object.hasOwn(options.events, event)) throw new TypeError("Unknown analytics event");
    const schema = options.events[event], accepted: AnalyticsEvent["properties"] = Object.create(null);
    if (!properties || typeof properties !== "object" || Array.isArray(properties) || Object.keys(properties).length > 20) throw new TypeError("Invalid event properties");
    for (const [key, value] of Object.entries(properties)) {
      const rule = Object.hasOwn(schema, key) ? schema[key] : undefined;
      if (rule === "number" ? typeof value !== "number" || !Number.isFinite(value) : rule === "boolean" ? typeof value !== "boolean" : !Array.isArray(rule) || typeof value !== "string" || !rule.includes(value)) throw new TypeError("Event properties do not match the allowlist");
      accepted[key] = value as string | number | boolean;
    }
    const now = Date.now();
    if (now >= nextPrune) { await options.store.prune(now - retention * 86400000); nextPrune = now + 60000; }
    const record = { event, subject: hash(subject), properties: accepted, at: now };
    await options.store.append(record);
    for (const adapter of options.adapters ?? []) {
      try { await adapter.capture(record); } catch { try { options.onAdapterError?.(); } catch {} }
    }
  }
  const range = (from: number, to: number) => {
    if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 0 || to <= from || to - from > 366 * 86400000) throw new TypeError("Invalid insight range");
  };
  const scan = async (from: number, to: number) => { range(from, to); const rows = await options.store.scan(from, to); if (rows.length > 100000) throw new Error("Insight range exceeds 100,000 events; narrow the range"); return rows.sort((a, b) => a.at - b.at); };
  return {
    capture,
    /** Public ingestion only. Protect insight/export/delete calls in your own authenticated routes. */
    async ingest(request: Request) {
      const response = (status: number) => new Response(null, { status, headers: { "Cache-Control": "no-store" } });
      if (request.method !== "POST") return response(405);
      if (request.headers.get("DNT") === "1" || request.headers.get("Sec-GPC") === "1") return response(204);
      try {
        assertSameOrigin(request, options.origin);
        if (!budget.consume("ingestion").allowed) return response(429);
        const input = await parseInput(request, value => {
          const v = value as Record<string, unknown>;
          if (!v || v.consent !== true || typeof v.event !== "string" || typeof v.subject !== "string") throw new ValidationError({ _form: ["Consent and a valid event are required"] });
          return v;
        }, { maxBytes: 8192 });
        await capture(input.event as string, input.subject as string, (input.properties ?? {}) as Record<string, unknown>);
        return response(204);
      } catch (error) { return error instanceof Response ? error : response(error instanceof TypeError ? 422 : 503); }
    },
    async trends(event: string, from: number, to: number, bucketMs = 86400000) {
      if (!Number.isSafeInteger(bucketMs) || bucketMs < 60000) throw new TypeError("Invalid trend bucket");
      const counts = new Map<number, number>();
      for (const row of await scan(from, to)) if (row.event === event) { const bucket = Math.floor(row.at / bucketMs) * bucketMs; counts.set(bucket, (counts.get(bucket) ?? 0) + 1); }
      return [...counts].map(([at, count]) => ({ at, count }));
    },
    async funnel(steps: string[], from: number, to: number, windowMs = 86400000) {
      if (steps.length < 2 || steps.length > 5 || steps.some(s => !Object.hasOwn(options.events, s)) || !Number.isSafeInteger(windowMs) || windowMs < 1) throw new TypeError("Funnels need 2–5 known events and a positive window");
      const states = new Map<string, { next: number; start: number; reached: Set<number> }>(), counts = steps.map(() => 0);
      for (const row of await scan(from, to)) {
        let state = states.get(row.subject);
        if (!state) states.set(row.subject, state = { next: 0, start: row.at, reached: new Set() });
        if (row.at - state.start > windowMs) { state.next = 0; state.start = row.at; }
        if (row.event !== steps[state.next]) continue;
        if (state.next === 0) state.start = row.at;
        if (!state.reached.has(state.next)) { counts[state.next]++; state.reached.add(state.next); }
        state.next++;
      }
      return steps.map((event, i) => ({ event, subjects: counts[i] }));
    },
    async retention(startEvent: string, returnEvent: string, from: number, to: number, periodMs = 86400000, periods = 7) {
      if (!Object.hasOwn(options.events, startEvent) || !Object.hasOwn(options.events, returnEvent) || !Number.isSafeInteger(periodMs) || periodMs < 60000 || !Number.isSafeInteger(periods) || periods < 1 || periods > 90) throw new TypeError("Invalid retention query");
      const first = new Map<string, number>(), cohorts = new Map<number, { subjects: Set<string>; returned: Set<string>[] }>();
      for (const row of await scan(from, to)) {
        if (!first.has(row.subject) && row.event === startEvent) first.set(row.subject, row.at);
        const start = first.get(row.subject); if (start === undefined) continue;
        const at = Math.floor(start / periodMs) * periodMs;
        let cohort = cohorts.get(at); if (!cohort) cohorts.set(at, cohort = { subjects: new Set(), returned: Array.from({ length: periods }, () => new Set()) });
        cohort.subjects.add(row.subject);
        const period = Math.floor((row.at - at) / periodMs);
        if (row.event === returnEvent && period < periods) cohort.returned[period].add(row.subject);
      }
      return [...cohorts].map(([at, c]) => ({ at, subjects: c.subjects.size, returned: c.returned.map(s => s.size) }));
    },
    exportSubject: (opaqueSubject: string) => options.store.exportSubject(hash(opaqueSubject)),
    deleteSubject: (opaqueSubject: string) => options.store.deleteSubject(hash(opaqueSubject)),
    prune: () => options.store.prune(Date.now() - retention * 86400000),
  };
}
