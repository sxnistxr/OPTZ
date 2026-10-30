import { expect, test } from "bun:test";
import { createAnalyticsClient } from "../src/client";
test("browser helper sends nothing before consent or under DNT, uses no persistent identity", async () => {
  const descriptors = ["location", "navigator", "localStorage", "sessionStorage"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  const originalFetch = globalThis.fetch, bodies: Record<string, unknown>[] = [];
  const navigation = { doNotTrack: "0", globalPrivacyControl: false };
  Object.defineProperty(globalThis, "location", { configurable: true, value: new URL("https://app.test/path?private=secret") });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: navigation });
  for (const key of ["localStorage", "sessionStorage"]) Object.defineProperty(globalThis, key, { configurable: true, get() { throw new Error("Persistent browser storage must not be read"); } });
  globalThis.fetch = (async (_url: unknown, options?: RequestInit) => { bodies.push(JSON.parse(options!.body as string)); return new Response(null, { status: 204 }); }) as unknown as typeof fetch;
  try {
    const a = createAnalyticsClient({ endpoint: "/api/analytics", events: ["viewed"] });
    expect(await a.capture("viewed")).toBe(false); expect(bodies.length).toBe(0);
    a.setConsent(true); expect(await a.capture("viewed")).toBe(true); expect(bodies.length).toBe(1); expect(JSON.stringify(bodies)).not.toContain("private");
    const firstSubject = bodies[0].subject;
    navigation.doNotTrack = "1"; expect(await a.capture("viewed")).toBe(false); navigation.doNotTrack = "0";
    navigation.globalPrivacyControl = true; expect(await a.capture("viewed")).toBe(false); navigation.globalPrivacyControl = false;
    a.setConsent(false); a.setConsent(true); await a.capture("viewed"); expect(bodies[1].subject).not.toBe(firstSubject);
    expect(() => a.identify("private@example.test")).toThrow(); expect(await a.capture("unlisted")).toBe(false);
  } finally { globalThis.fetch = originalFetch; for (const [key, value] of descriptors) { if (value) Object.defineProperty(globalThis, key, value); else Reflect.deleteProperty(globalThis, key); } }
});
