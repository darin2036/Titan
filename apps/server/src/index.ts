import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { type RecordView, hash, uid, now } from "./contracts.ts";
export class Index {
  db: DatabaseSync;
  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL;
 CREATE TABLE IF NOT EXISTS units(id TEXT PRIMARY KEY,revision TEXT NOT NULL,data TEXT NOT NULL);
 CREATE VIRTUAL TABLE IF NOT EXISTS search USING fts5(id UNINDEXED,title,body);
 CREATE TABLE IF NOT EXISTS vectors(id TEXT PRIMARY KEY,revision TEXT,model TEXT,data TEXT);
 CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,kind TEXT,payload TEXT,status TEXT,attempts INTEGER DEFAULT 0,next_at INTEGER DEFAULT 0,error TEXT);
 CREATE TABLE IF NOT EXISTS tokens(hash TEXT PRIMARY KEY,id TEXT,scopes TEXT);
 CREATE TABLE IF NOT EXISTS observed(path TEXT PRIMARY KEY,revision TEXT);
 CREATE TABLE IF NOT EXISTS outcomes(key TEXT PRIMARY KEY,result TEXT);
 `);
    this.db.exec("UPDATE jobs SET status='pending' WHERE status='running'");
  }
  replace(
    units: RecordView[],
    eligible = new Set(
      units.filter((u) => u.lifecycle === "active").map((u) => u.id),
    ),
  ) {
    this.db.exec("BEGIN");
    try {
      this.db.exec("DELETE FROM units; DELETE FROM search;");
      const put = this.db.prepare("INSERT INTO units VALUES(?,?,?)");
      const search = this.db.prepare("INSERT INTO search VALUES(?,?,?)");
      for (const u of units) {
        put.run(u.id, u.revision, JSON.stringify(u));
        if (eligible.has(u.id)) search.run(u.id, u.title, u.body);
      }
      this.db.exec(
        "DELETE FROM vectors WHERE id NOT IN (SELECT id FROM search) OR revision != (SELECT revision FROM units WHERE units.id=vectors.id); COMMIT",
      );
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  all(): RecordView[] {
    return (
      this.db
        .prepare(
          "SELECT data FROM units ORDER BY json_extract(data,'$.updatedAt') DESC",
        )
        .all() as { data: string }[]
    ).map((r) => JSON.parse(r.data));
  }
  search(query: string) {
    const terms = query.match(/[\p{L}\p{N}_-]+/gu)?.slice(0, 20) ?? [];
    if (!terms.length)
      return this.all().filter((u) => u.lifecycle === "active");
    const match = terms
      .map((t) => '"' + t.replaceAll('"', "") + '"')
      .join(" OR ");
    return (
      this.db
        .prepare(
          "SELECT units.data FROM search JOIN units ON units.id=search.id WHERE search MATCH ? ORDER BY bm25(search) LIMIT 50",
        )
        .all(match) as { data: string }[]
    ).map((r) => JSON.parse(r.data) as RecordView);
  }
  nearest(vector: number[], model: string) {
    const norm = (v: number[]) => Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    const q = norm(vector);
    if (!q) return [];
    return (
      this.db
        .prepare(
          "SELECT vectors.id,vectors.data FROM vectors JOIN search ON search.id=vectors.id WHERE model=?",
        )
        .all(model) as { id: string; data: string }[]
    )
      .map((row) => {
        const values = JSON.parse(row.data) as number[];
        const denominator = q * norm(values);
        return {
          id: row.id,
          score:
            values.length === vector.length && denominator
              ? values.reduce((s, x, i) => s + x * vector[i], 0) / denominator
              : -1,
        };
      })
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map((r) => r.id);
  }
  enqueue(id: string, kind: string, payload: unknown) {
    this.db
      .prepare(
        "INSERT OR IGNORE INTO jobs(id,kind,payload,status) VALUES(?,?,?,'pending')",
      )
      .run(id, kind, JSON.stringify(payload));
  }
  jobs() {
    return this.db
      .prepare(
        "SELECT id,kind,status,attempts,error FROM jobs ORDER BY rowid DESC LIMIT 100",
      )
      .all();
  }
  token(scopes: string[]) {
    const token = uid() + uid();
    this.db
      .prepare("INSERT INTO tokens VALUES(?,?,?)")
      .run(hash(token), uid(), JSON.stringify(scopes));
    return token;
  }
  resolveToken(token: string) {
    const row = this.db
      .prepare("SELECT id,scopes FROM tokens WHERE hash=?")
      .get(hash(token)) as { id: string; scopes: string } | undefined;
    return row
      ? {
          id: row.id,
          role: "agent" as const,
          scopes: JSON.parse(row.scopes) as string[],
        }
      : null;
  }
  close() {
    this.db.close();
  }
}
