import type { Database } from "bun:sqlite";
import type { AnalyticsStore, AnalyticsEvent } from "./index";
export function sqliteAnalyticsStore(db: Database, maxEvents = 1000000): AnalyticsStore {
  if (!Number.isSafeInteger(maxEvents) || maxEvents < 1) throw new TypeError("Invalid event capacity");
  db.exec("CREATE TABLE IF NOT EXISTS optz_analytics_events (id INTEGER PRIMARY KEY, event TEXT NOT NULL, subject TEXT NOT NULL, properties TEXT NOT NULL, at INTEGER NOT NULL); CREATE INDEX IF NOT EXISTS optz_analytics_time ON optz_analytics_events(at); CREATE INDEX IF NOT EXISTS optz_analytics_subject ON optz_analytics_events(subject,at)");
  db.exec("CREATE TABLE IF NOT EXISTS optz_analytics_count (id INTEGER PRIMARY KEY CHECK(id=1), n INTEGER NOT NULL); INSERT OR IGNORE INTO optz_analytics_count SELECT 1,count(*) FROM optz_analytics_events; CREATE TRIGGER IF NOT EXISTS optz_analytics_insert AFTER INSERT ON optz_analytics_events BEGIN UPDATE optz_analytics_count SET n=n+1 WHERE id=1; END; CREATE TRIGGER IF NOT EXISTS optz_analytics_delete AFTER DELETE ON optz_analytics_events BEGIN UPDATE optz_analytics_count SET n=n-1 WHERE id=1; END;");
  const decode = (rows: { event: string; subject: string; properties: string; at: number }[]): AnalyticsEvent[] => rows.map(row => ({ ...row, properties: JSON.parse(row.properties) }));
  return {
    append(event) { const inserted = db.query("INSERT INTO optz_analytics_events(event,subject,properties,at) SELECT ?,?,?,? WHERE (SELECT n FROM optz_analytics_count WHERE id=1)<?").run(event.event, event.subject, JSON.stringify(event.properties), event.at, maxEvents); if (!inserted.changes) throw new Error("Event capacity reached"); },
    scan(from, to) { return decode(db.query<{ event: string; subject: string; properties: string; at: number }, [number, number]>("SELECT event,subject,properties,at FROM optz_analytics_events WHERE at>=? AND at<? ORDER BY at,id LIMIT 100001").all(from, to)); },
    exportSubject(subject) { const rows = db.query<{ event: string; subject: string; properties: string; at: number }, [string]>("SELECT event,subject,properties,at FROM optz_analytics_events WHERE subject=? ORDER BY at,id LIMIT 100001").all(subject); if (rows.length > 100000) throw new Error("Export exceeds local event budget"); return decode(rows); },
    deleteSubject(subject) { db.query("DELETE FROM optz_analytics_events WHERE subject=?").run(subject); },
    prune(before) { db.query("DELETE FROM optz_analytics_events WHERE at<?").run(before); },
  };
}
