import { S3Client, CreateMultipartUploadCommand, UploadPartCommand, PutObjectCommand, ListPartsCommand, CompleteMultipartUploadCommand, AbortMultipartUploadCommand, HeadObjectCommand, CopyObjectCommand, DeleteObjectCommand, GetObjectCommand, type S3ClientConfig } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { ObjectProvider, UploadRecord, StoredPart } from "./index";

/** AWS S3, R2 and B2 use the same protocol. Supply endpoint/region from the provider's docs. */
export function createS3Provider(options: { bucket: string; client: S3ClientConfig; checksums?: boolean; urlSeconds?: number }): ObjectProvider {
  const seconds = options.urlSeconds ?? 300;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{1,254}$/.test(options.bucket) || !Number.isSafeInteger(seconds) || seconds < 1 || seconds > 900) throw new TypeError("Invalid bucket or signed URL lifetime");
  if (options.client.endpoint) {
    if (typeof options.client.endpoint !== "string") throw new TypeError("Custom object-storage endpoints must be fixed HTTPS URLs");
    const endpoint = new URL(options.client.endpoint);
    if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new TypeError("Custom object-storage endpoints must be fixed HTTPS URLs");
  }
  const checksums = options.checksums ?? true;
  const client = new S3Client({ requestHandler: { requestTimeout: 30000, connectionTimeout: 3000 }, ...options.client, requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED", maxAttempts: 2 });
  const params = (r: UploadRecord) => ({ Bucket: options.bucket, Key: r.key, UploadId: r.uploadId });
  const missing = (error: unknown) => { const e = error as { name?: string; $metadata?: { httpStatusCode?: number } }; return e?.$metadata?.httpStatusCode === 404 || ["NoSuchKey", "NotFound", "NoSuchUpload"].includes(e?.name ?? ""); };
  return {
    checksums,
    async create(r) { const result = await client.send(new CreateMultipartUploadCommand({ Bucket: options.bucket, Key: r.key, ContentType: r.type, ...(checksums ? { ChecksumAlgorithm: "SHA256" } : {}) })); if (!result.UploadId) throw new Error("Provider did not return an upload ID"); return result.UploadId; },
    async sign(r, part, checksum) {
      const length = part === undefined ? r.size : Math.min(r.partSize, r.size - (part - 1) * r.partSize);
      const command = part === undefined
        ? new PutObjectCommand({ Bucket: options.bucket, Key: r.key, ContentType: r.type, ContentLength: length, ...(checksums ? { ChecksumSHA256: checksum } : {}) })
        : new UploadPartCommand({ ...params(r), PartNumber: part, ContentLength: length, ...(checksums ? { ChecksumSHA256: checksum } : {}) });
      const signing = { expiresIn: seconds, signableHeaders: new Set(["content-length", ...(part === undefined ? ["content-type"] : [])]), unhoistableHeaders: new Set(checksums ? ["x-amz-checksum-sha256"] : []) };
      const url = command instanceof PutObjectCommand ? await getSignedUrl(client, command, signing) : await getSignedUrl(client, command, signing);
      return { url, headers: { ...(part === undefined ? { "Content-Type": r.type } : {}), ...(checksums ? { "x-amz-checksum-sha256": checksum! } : {}) } };
    },
    async parts(r) {
      const parts: StoredPart[] = []; let marker: string | undefined;
      do {
        const page = await client.send(new ListPartsCommand({ ...params(r), PartNumberMarker: marker, MaxParts: 1000 }));
        for (const p of page.Parts ?? []) { if (!p.PartNumber || p.Size === undefined || !p.ETag) throw new Error("Invalid provider part metadata"); parts.push({ number: p.PartNumber, size: p.Size, etag: p.ETag, checksum: p.ChecksumSHA256 }); }
        const next = page.IsTruncated ? page.NextPartNumberMarker : undefined;
        if (parts.length > 10000 || (page.IsTruncated && (!next || next === marker))) throw new Error("Invalid multipart pagination");
        marker = next;
      } while (marker);
      return parts;
    },
    async complete(r, parts) { await client.send(new CompleteMultipartUploadCommand({ ...params(r), MultipartUpload: { Parts: parts.map(p => ({ PartNumber: p.number, ETag: p.etag, ...(checksums ? { ChecksumSHA256: p.checksum } : {}) })) } })); },
    async abort(r) { if (r.uploadId) try { await client.send(new AbortMultipartUploadCommand(params(r))); } catch (error) { if (!missing(error)) throw error; } },
    async head(key) { try { const result = await client.send(new HeadObjectCommand({ Bucket: options.bucket, Key: key })); if (result.ContentLength === undefined || !result.ContentType) throw new Error("Missing object metadata"); return { size: result.ContentLength, type: result.ContentType }; } catch (error) { if (missing(error)) return; throw error; } },
    async promote(r) { await client.send(new CopyObjectCommand({ Bucket: options.bucket, Key: r.finalKey, CopySource: `${options.bucket}/${r.key.split("/").map(encodeURIComponent).join("/")}`, MetadataDirective: "COPY" })); },
    async remove(key) { await client.send(new DeleteObjectCommand({ Bucket: options.bucket, Key: key })); },
    async download(r) {
      const name = encodeURIComponent(r.name.toWellFormed()).replace(/[!'()*]/g, c => "%" + c.charCodeAt(0).toString(16));
      return { url: await getSignedUrl(client, new GetObjectCommand({ Bucket: options.bucket, Key: r.finalKey, ResponseContentDisposition: `attachment; filename*=UTF-8''${name}`, ResponseContentType: "application/octet-stream" }), { expiresIn: seconds }) };
    },
  };
}
