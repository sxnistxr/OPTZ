import type { Database } from "bun:sqlite";
import type { UploadRecord, UploadStore } from "./index";
export function sqliteUploadStore(db: Database, options: { bytesPerOwner: number; filesPerOwner?: number; pendingPerOwner?: number }) : UploadStore {
  const files = options.filesPerOwner ?? 100, pending = options.pendingPerOwner ?? 10;
  if (![options.bytesPerOwner, files, pending].every(v => Number.isSafeInteger(v) && v > 0)) throw new TypeError("Invalid upload quotas");
  db.exec("CREATE TABLE IF NOT EXISTS optz_uploads (id TEXT PRIMARY KEY, owner TEXT NOT NULL, size INTEGER NOT NULL, state TEXT NOT NULL, expires_at INTEGER NOT NULL, record TEXT NOT NULL, locked_at INTEGER NOT NULL DEFAULT 0); CREATE INDEX IF NOT EXISTS optz_uploads_owner ON optz_uploads(owner,state); CREATE INDEX IF NOT EXISTS optz_uploads_expiry ON optz_uploads(state,expires_at)");
  const get = (id: string) => { const row = db.query<{ record: string; state: UploadRecord["state"]; expires_at: number }, [string]>("SELECT record,state,expires_at FROM optz_uploads WHERE id=?").get(id); return row ? { ...JSON.parse(row.record), state: row.state, expiresAt: row.expires_at } as UploadRecord : undefined; };
  return {
    reserve(record) {
      // One conditional statement reserves quota across concurrent connections/processes.
      const insert = db.query("INSERT INTO optz_uploads(id,owner,size,state,expires_at,record) SELECT ?,?,?,?,?,? WHERE (SELECT coalesce(sum(size),0) FROM optz_uploads WHERE owner=?)+?<=? AND (SELECT count(*) FROM optz_uploads WHERE owner=?)<? AND (SELECT count(*) FROM optz_uploads WHERE owner=? AND state NOT IN ('aborted','complete'))<?").run(record.id, record.owner, record.size, record.state, record.expiresAt, JSON.stringify(record), record.owner, record.size, options.bytesPerOwner, record.owner, files, record.owner, pending);
      if (!insert.changes) throw new Response("Upload quota reached", { status: 409 });
    },
    get,
    activate(id, uploadId) { const r = get(id); if (!r || r.state !== "pending") throw new Error("Upload not pending"); r.uploadId = uploadId; if (!db.query("UPDATE optz_uploads SET state='active',record=? WHERE id=? AND state='pending'").run(JSON.stringify(r), id).changes) throw new Error("Upload state changed"); },
    claim(id, from = "active") { return db.query("UPDATE optz_uploads SET state='completing',locked_at=? WHERE id=? AND (state=? OR (state='completing' AND locked_at<?))").run(Date.now(), id, from, Date.now() - 3600000).changes === 1; },
    // Signed staging URLs cannot be revoked. Hold quota until their maximum 15-minute TTL + skew.
    finish(id, state) { if (state === "aborted") db.query("UPDATE optz_uploads SET state='aborted',expires_at=?,locked_at=0 WHERE id=?").run(Date.now() + 16 * 60000, id); else db.query("UPDATE optz_uploads SET state=?,locked_at=0 WHERE id=?").run(state, id); },
    release(id) { db.query("DELETE FROM optz_uploads WHERE id=?").run(id); },
    expired(now) { return db.query<{ record: string; state: UploadRecord["state"]; expires_at: number }, [number, number, number]>("SELECT record,state,expires_at FROM optz_uploads WHERE (state='aborted' AND expires_at<=?) OR (expires_at<=? AND (state IN ('pending','active') OR (state='completing' AND locked_at<?))) LIMIT 100").all(now, now - 16 * 60000, now - 3600000).map(r => ({ ...JSON.parse(r.record), state: r.state, expiresAt: r.expires_at })); },
  };
}
