import { assertSameOrigin, createRateLimiter } from "optz/security";
import { parseInput, ValidationError } from "optz/forms";
export type ComponentStatus = "operational" | "degraded" | "outage" | "maintenance";
export type IncidentStatus = "investigating" | "identified" | "monitoring" | "resolved";
export interface StatusSnapshot {
  components: { id: string; name: string; status: ComponentStatus; updatedAt: number }[];
  incidents: { id: string; title: string; status: IncidentStatus; createdAt: number; updatedAt: number; updates: { status: IncidentStatus; message: string; at: number }[] }[];
}
export interface StatusStore {
  snapshot(): StatusSnapshot | Promise<StatusSnapshot>;
  component(value: StatusSnapshot["components"][number], actor: string): void | Promise<void>;
  incident(value: { id: string; title?: string; status: IncidentStatus; message: string; at: number }, actor: string): void | Promise<void>;
}
const componentStates = ["operational", "degraded", "outage", "maintenance"];
const incidentStates = ["investigating", "identified", "monitoring", "resolved"];
export function overallStatus(components: StatusSnapshot["components"]) {
  return ["outage", "degraded", "maintenance"].find(s => components.some(c => c.status === s)) ?? "operational";
}
/** Public GET and session-authorized mutations. Mount once at the configured API prefix. */
export function createStatusHandler(options: { store: StatusStore; origin: string; authorizeAdmin: (request: Request) => Promise<{ id: string } | null>; prefix?: string; publicRequestsPerMinute?: number }) {
  const prefix = options.prefix ?? "/api/status";
  if (!/^\/[a-zA-Z0-9/_-]+$/.test(prefix) || prefix.endsWith("/")) throw new TypeError("Invalid status prefix");
  const publicBudget = createRateLimiter({ limit: options.publicRequestsPerMinute ?? 600, windowMs: 60000, maxKeys: 1 });
  const adminBudget = createRateLimiter({ limit: 60, windowMs: 60000, maxKeys: 100 });
  const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  return async (request: Request) => {
    const path = new URL(request.url).pathname;
    if (path !== prefix && !path.startsWith(prefix + "/")) return json({ error: "Not found" }, 404);
    if (request.method === "GET" && path === prefix) {
      if (!publicBudget.consume("public").allowed) return json({ error: "Status request limit reached" }, 429);
      return json(await options.store.snapshot());
    }
    if (request.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "GET, POST", "Cache-Control": "no-store" } });
    try {
      assertSameOrigin(request, options.origin);
      const actor = await options.authorizeAdmin(request);
      if (!actor || typeof actor.id !== "string" || !actor.id || actor.id.length > 128) return json({ error: "Administrator required" }, 403);
      if (!adminBudget.consume(actor.id).allowed) return json({ error: "Update limit reached" }, 429);
      const value = await parseInput(request, input => {
        if (!input || typeof input !== "object" || Array.isArray(input)) throw new ValidationError({ _form: ["Send an object"] });
        const data = input as Record<string, unknown>;
        const string = (key: string, max: number, optional = false) => {
          const value = data[key];
          if (optional && value === undefined) return undefined;
          if (typeof value !== "string" || !value.trim() || value.length > max || /[\u0000-\u0008]/.test(value)) throw new ValidationError({ [key]: ["Invalid value"] });
          return value.trim();
        };
        return { id: string("id", 128, true), name: string("name", 120, true), title: string("title", 160, true), status: string("status", 32)!, message: string("message", 2000, true) };
      }, { maxBytes: 12000 });
      const now = Date.now();
      if (path === `${prefix}/components`) {
        if (!value.id || !/^[a-zA-Z0-9_-]{1,64}$/.test(value.id) || !value.name || !componentStates.includes(value.status)) return json({ error: "Invalid component" }, 422);
        await options.store.component({ id: value.id, name: value.name, status: value.status as ComponentStatus, updatedAt: now }, actor.id);
      } else if (path === `${prefix}/incidents`) {
        if (!value.title || !value.message || !incidentStates.includes(value.status)) return json({ error: "Invalid incident" }, 422);
        value.id = crypto.randomUUID();
        await options.store.incident({ id: value.id, title: value.title, status: value.status as IncidentStatus, message: value.message, at: now }, actor.id);
      } else if (path.startsWith(`${prefix}/incidents/`)) {
        const id = path.slice(`${prefix}/incidents/`.length);
        if (!/^[a-f0-9-]{36}$/i.test(id) || !value.message || !incidentStates.includes(value.status)) return json({ error: "Invalid incident update" }, 422);
        value.id = id;
        await options.store.incident({ id, status: value.status as IncidentStatus, message: value.message, at: now }, actor.id);
      } else return json({ error: "Not found" }, 404);
      return json({ id: value.id, saved: true });
    } catch (error) {
      if (error instanceof Response) return error;
      // Store/SQL errors must not expose private incident text, queries or actor details.
      return json({ error: "Status update could not be saved" }, 409);
    }
  };
}
