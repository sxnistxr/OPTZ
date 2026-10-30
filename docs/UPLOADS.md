# Direct and multipart uploads

`@optz/uploads` adds authenticated upload control APIs over S3-compatible storage. File bytes
go directly from the browser to storage; OPTZ reserves quota, signs short-lived requests and
approves a separate immutable copy. Existing small local uploads remain `optz/storage`.

## Compose the server

The package is part of this workspace; add `"@optz/uploads": "workspace:*"` to an app's
dependencies and run `bun install` at the repository root. Provider SDKs are confined to the
server-only `/s3` export, never the optional `/client` helper.

```ts
// app/lib/uploads.server.ts
import { openDatabase } from "optz/sqlite";
import { createUploads, createUploadHandler } from "@optz/uploads";
import { sqliteUploadStore } from "@optz/uploads/sqlite";
import { createS3Provider } from "@optz/uploads/s3";
import { getAuth } from "./auth.server";

const db = openDatabase(process.env.UPLOAD_DATABASE_PATH!);
const uploads = createUploads({
  store: sqliteUploadStore(db, { bytesPerOwner: 1024 ** 3, pendingPerOwner: 3 }),
  provider: createS3Provider({
    bucket: process.env.S3_BUCKET!,
    client: { endpoint: process.env.S3_ENDPOINT!, region: "auto", forcePathStyle: true },
    checksums: true,
    urlSeconds: 300,
  }),
  types: ["text/plain", "image/png", "image/jpeg", "application/pdf"],
  maxBytes: 100 * 1024 ** 2,
});

export const handleUpload = createUploadHandler({
  uploads,
  origin: process.env.PUBLIC_URL!,
  authorize: async request => {
    const session = await getAuth().getSession(request);
    return session ? { id: session.user.id } : null;
  },
});
```

For AWS use the bucket's region; R2 commonly uses `auto`, and B2 uses the region in its endpoint.
Supply provider credentials through its supported server credential chain, IAM roles or
[Doppler](DOPPLER.md). Keep the bucket private and configure CORS for the application's exact
origin, PUT and the signed Content-Type/checksum headers. Only the file-upload page needs its
storage origin added to `connect-src`; do not relax every page's CSP.

## Mount the control route

```ts
// app/api/uploads/[operation].ts
import type { ApiContext } from "optz";
import { handleUpload } from "$lib/uploads.server";
export const POST = ({ request }: ApiContext) => handleUpload(request);
```

All actions require a session, same-origin mutation checks, bounded JSON and the trusted
session's owner ID. The adapter uses a bounded per-owner request budget. Forwarded IP headers
do not decide ownership or quotas.

| POST action | Input | Result |
|---|---|---|
| `initiate` | `name`, `type`, `size` | Opaque ID and upload plan; reserves quota before provider work |
| `resume` | `id` | Current plan and provider-reported uploaded parts |
| `sign` | `id`, optional `part`, SHA-256 `checksum` when enabled | Short-lived URL and required headers |
| `complete` | `id` | Approved private key and metadata; does not trust browser ETags |
| `abort` | `id` | Aborts provider multipart state, removes staging objects and cancels the reservation |
| `download` | `id` | Owner-only, short-lived attachment URL for an approved object |
| `delete` | `id` | Removes the approved object and cancels its reservation |

Quota reservations count active and completed uploads, plus recently cancelled uploads. Expired reservations are retained until
cleanup removes provider resources. Cancellation holds its reservation for 16 minutes (the
maximum signed-URL TTL plus clock skew), because an already issued staging PUT cannot be
revoked. Cleanup deletes any replayed staging object before releasing the reservation. Opening
and cancelling sessions therefore cannot immediately evade the byte budget. SQLite uses an
atomic conditional insert and compare-and-swap finalization across connections/processes.
Unknown and cross-owner IDs both answer 404.

## Browser helper

```ts
import { uploadFile } from "@optz/uploads/client";

const controller = new AbortController();
const result = await uploadFile(selectedFile, {
  endpoint: "/api/uploads",
  signal: controller.signal,
  concurrency: 3,
  retries: 2,
  onProgress: (sent, total) => console.log(sent, total),
});
```

The helper has no provider SDK or persistent browser state. It uses File slices, fetch and
Web Crypto. Failed calls attach `uploadId` to the error; retain it and pass `resumeId` after
selecting the same file. A part is skipped only if the provider's SHA-256 matches the local
slice. With checksums disabled, resumed parts are re-uploaded rather than trusting size or
ETag as file identity. An error aborts sibling workers; retries and concurrency are bounded.

The default multipart threshold is 32 MiB and part size 8 MiB. Part buffers are bounded to
64 MiB, with concurrency 1–6. Whole-file checksum buffering applies only below the single-PUT
threshold, which is capped at 64 MiB. Progress counts successful bytes, not speculative in-flight
progress. Stopping retains resumable staging state; call the abort action to discard it.

## Integrity and approval

The S3 adapter signs content length and, for a single PUT, content type. SHA-256 mode binds the
checksum header and checks provider part metadata. Some compatible providers support only a
subset of S3 checksum features; set `checksums: false` only after verifying that provider's
capabilities. This mode still checks declared sizes and uses immutable promotion; it does not
pretend that an ETag is SHA-256.

Completion lists provider parts, checks contiguous numbering and exact sizes, completes the
multipart object, validates its metadata, then copies it to a different never-presigned key.
Reusing an old staging URL cannot change approved bytes. An optional asynchronous `inspect`
hook receives the immutable copy's key before approval; reject it to withhold access. This
supports a scanner/content-inspection service without proxying the file through OPTZ.

Transport MIME declarations are not content inspection. Keep unapproved data private and
serve downloads as attachments. The supplied S3 adapter uses native server-side CopyObject
promotion and intentionally caps an object at **5 GiB**, although providers may support larger
objects. Its default application limit is 100 MiB. Larger-object approval requires a separate
multipart-copy/worker design, not a silent removal of the approval boundary.

## Cleanup and recovery

Schedule `await uploads.cleanup()` in an explicit maintenance job. It processes at most 100
eligible sessions per call, aborts multipart state and removes staging/unfinished promoted
objects before releasing quota. Unfinished sessions become eligible after their upload
lifetime plus the signed-URL grace period; cancelled sessions after the 16-minute hold. SQLite can reclaim a crashed finalization after a one-hour
lease. Run cleanup repeatedly when more than 100 sessions have expired.

Also configure provider lifecycle rules to abort incomplete multipart uploads and expire the
`pending/` prefix. Staging URLs are bearer capabilities until expiry (maximum 15 minutes),
so never log or publicly cache them. Completed object deletion uses an authenticated action.

The [auth example](../apps/auth/README.md) includes a protected `/files` route and native
progress/cancellation UI. Live provider compatibility and CORS still need verification with
your bucket; local tests cover presigning plus a provider fixture's ownership, quota, integrity,
scan and recovery behavior.

Primary references: [S3 multipart limits](https://docs.aws.amazon.com/AmazonS3/latest/userguide/qfacts.html),
[R2 compatibility](https://developers.cloudflare.com/r2/api/s3/api/),
[B2 S3 compatibility](https://www.backblaze.com/docs/cloud-storage-s3-compatible-api).
