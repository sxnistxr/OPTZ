import type { Database } from "bun:sqlite";
import type { StatusStore, StatusSnapshot, IncidentStatus } from "./index";
export function sqliteStatusStore(db: Database): StatusStore {
  db.exec(`CREATE TABLE IF NOT EXISTS optz_status_components (id TEXT PRIMARY KEY, name TEXT NOT NULL, status TEXT NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS optz_status_incidents (id TEXT PRIMARY KEY, title TEXT NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS optz_status_updates (id INTEGER PRIMARY KEY, incident_id TEXT NOT NULL REFERENCES optz_status_incidents(id), status TEXT NOT NULL, message TEXT NOT NULL, at INTEGER NOT NULL, actor TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS optz_status_updates_incident ON optz_status_updates(incident_id,at);
    CREATE TABLE IF NOT EXISTS optz_status_audit (id INTEGER PRIMARY KEY, component_id TEXT NOT NULL, status TEXT NOT NULL, at INTEGER NOT NULL, actor TEXT NOT NULL);`);
  return {
    snapshot() {
      const components = db.query<StatusSnapshot["components"][number], []>("SELECT id,name,status,updated_at updatedAt FROM optz_status_components ORDER BY name").all();
      const incidents = db.query<Omit<StatusSnapshot["incidents"][number], "updates">, []>("SELECT id,title,status,created_at createdAt,updated_at updatedAt FROM optz_status_incidents ORDER BY updated_at DESC LIMIT 30").all();
      return { components, incidents: incidents.map(incident => ({ ...incident, updates: db.query<{ status: IncidentStatus; message: string; at: number }, [string]>("SELECT status,message,at FROM optz_status_updates WHERE incident_id=? ORDER BY id DESC LIMIT 100").all(incident.id).reverse() })) };
    },
    component(value, actor) {
      db.transaction(() => {
        if (!db.query("SELECT 1 FROM optz_status_components WHERE id=?").get(value.id) && db.query<{ n: number }, []>("SELECT count(*) n FROM optz_status_components").get()!.n >= 100) throw new Error("Component limit");
        db.query("INSERT INTO optz_status_components VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,status=excluded.status,updated_at=excluded.updated_at").run(value.id, value.name, value.status, value.updatedAt);
        db.query("INSERT INTO optz_status_audit(component_id,status,at,actor) VALUES (?,?,?,?)").run(value.id, value.status, value.updatedAt, actor);
      }).immediate();
    },
    incident(value, actor) {
      db.transaction(() => {
        if (value.title) db.query("INSERT INTO optz_status_incidents VALUES (?,?,?,?,?)").run(value.id, value.title, value.status, value.at, value.at);
        else if (!db.query("UPDATE optz_status_incidents SET status=?,updated_at=? WHERE id=?").run(value.status, value.at, value.id).changes) throw new Error("Incident missing");
        db.query("INSERT INTO optz_status_updates(incident_id,status,message,at,actor) VALUES (?,?,?,?,?)").run(value.id, value.status, value.message, value.at, actor);
      }).immediate();
    },
  };
}
