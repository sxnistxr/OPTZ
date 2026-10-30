import { openDatabase } from "optz/sqlite";
import { createStatusHandler } from "@optz/status";
import { sqliteStatusStore } from "@optz/status/sqlite";
import { createAnalytics } from "@optz/analytics";
import { sqliteAnalyticsStore } from "@optz/analytics/sqlite";
import { createUploads, createUploadHandler } from "@optz/uploads";
import { sqliteUploadStore } from "@optz/uploads/sqlite";
import { getAuth } from "./auth.server";

export const origin = () => process.env.PUBLIC_URL ?? "http://localhost:3008";
let db: ReturnType<typeof openDatabase> | undefined;
const database = () => db ??= openDatabase(process.env.MODULES_DATABASE_PATH ?? ".data/modules.sqlite");
export async function administrator(request: Request) {
  const session = await getAuth().getSession(request);
  return session && session.user.emailVerified && session.user.id === process.env.MODULES_ADMIN_USER_ID ? { id: session.user.id } : null;
}
let statusStore: ReturnType<typeof sqliteStatusStore> | undefined;
export const status = () => statusStore ??= sqliteStatusStore(database());
let statusHandler: ReturnType<typeof createStatusHandler> | undefined;
export const handleStatus = (request: Request) => (statusHandler ??= createStatusHandler({ store: status(), origin: origin(), authorizeAdmin: administrator }))(request);
let analyticsInstance: ReturnType<typeof createAnalytics> | undefined;
export const analytics = () => {
  if (!process.env.ANALYTICS_HASH_SECRET) throw new Response("Analytics is not configured", { status: 503 });
  return analyticsInstance ??= createAnalytics({ store: sqliteAnalyticsStore(database()), secret: process.env.ANALYTICS_HASH_SECRET, origin: origin(),
    events: { page_viewed: { route: ["/status", "/account", "/metrics-demo"] }, started: {}, completed: {} }, retentionDays: 30 });
};
let uploadInstance: ReturnType<typeof initializeUploads> | undefined;
async function initializeUploads() {
  if (!process.env.S3_BUCKET || !process.env.S3_ENDPOINT) throw new Response("Object storage is not configured", { status: 503 });
  const { createS3Provider } = await import("@optz/uploads/s3");
  const uploads = createUploads({
    store: sqliteUploadStore(database(), { bytesPerOwner: 1024 ** 3, pendingPerOwner: 3 }),
    provider: createS3Provider({ bucket: process.env.S3_BUCKET, checksums: process.env.S3_SHA256 !== "false", client: { endpoint: process.env.S3_ENDPOINT, region: process.env.S3_REGION ?? "us-east-1", forcePathStyle: true } }),
    types: ["text/plain", "image/png", "image/jpeg", "application/pdf"], maxBytes: 100 * 1024 ** 2,
  });
  return { uploads, handle: createUploadHandler({ uploads, origin: origin(), authorize: async request => { const session = await getAuth().getSession(request); return session ? { id: session.user.id } : null; } }) };
}
const uploadServices = () => uploadInstance ??= initializeUploads().catch(error => { uploadInstance = undefined; throw error; });
export async function handleUploads(request: Request) {
  try { return await (await uploadServices()).handle(request); }
  catch (error) { return error instanceof Response ? error : new Response("Upload service unavailable", { status: 503 }); }
}
export async function maintainModules() {
  if (process.env.ANALYTICS_HASH_SECRET) await analytics().prune();
  const cleaned = process.env.S3_BUCKET && process.env.S3_ENDPOINT ? await (await uploadServices()).uploads.cleanup() : 0;
  return { expiredUploadsCleaned: cleaned };
}
