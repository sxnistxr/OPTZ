import { expect, test } from "bun:test";
import { uploadFile } from "../src/client";
test("browser resume skips only matching checksummed bytes and keeps provider SDKs out of transport", async () => {
  const original = globalThis.fetch, locationDescriptor = Object.getOwnPropertyDescriptor(globalThis, "location");
  Object.defineProperty(globalThis, "location", { configurable: true, value: new URL("https://app.test/files") });
  const file = new File([new Uint8Array(6 * 1024 ** 2)], "large.txt", { type: "text/plain" });
  const checksum = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest("SHA-256", await file.slice(0, 5 * 1024 ** 2).arrayBuffer()))));
  const id = crypto.randomUUID(), signed: number[] = []; let puts = 0;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.hostname === "objects.test") { puts++; expect(init!.credentials).toBe("omit"); expect(init!.body instanceof Blob).toBe(true); return new Response(null, { status: 200 }); }
    const body = JSON.parse(init!.body as string);
    if (url.pathname.endsWith("/resume")) return Response.json({ id, size: file.size, partSize: 5 * 1024 ** 2, parts: 2, multipart: true, checksums: true, uploadedParts: [{ number: 1, size: 5 * 1024 ** 2, checksum }] });
    if (url.pathname.endsWith("/sign")) { signed.push(body.part); expect(typeof body.checksum).toBe("string"); return Response.json({ url: "https://objects.test/part", headers: { "x-amz-checksum-sha256": body.checksum } }); }
    if (url.pathname.endsWith("/complete")) return Response.json({ id, key: "objects/approved" });
    throw new Error("Unexpected request");
  }) as unknown as typeof fetch;
  try { const result = await uploadFile(file, { endpoint: "/api/uploads", resumeId: id }); expect(result.key).toBe("objects/approved"); expect(signed).toEqual([2]); expect(puts).toBe(1); }
  finally { globalThis.fetch = original; if (locationDescriptor) Object.defineProperty(globalThis, "location", locationDescriptor); else Reflect.deleteProperty(globalThis, "location"); }
});
