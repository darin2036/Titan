import { DatabaseSync } from "node:sqlite";
import { chmodSync, mkdirSync, realpathSync, existsSync } from "node:fs";
import { dirname, relative, isAbsolute, join, basename } from "node:path";
import {
  GitStorage,
  decode,
  encode,
  type Change,
  type StorageAdapter,
} from "./storage.ts";
import { demand, type RecordView, type Unit } from "./contracts.ts";
/** Private overlay: any transaction involving connected knowledge stays out of Git. */
export class ConnectedStorage implements StorageAdapter {
  db: DatabaseSync;
  root: string;
  safePrivateState: boolean;
  constructor(
    public git: GitStorage,
    path: string,
  ) {
    this.root = git.root;
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const actualPath = existsSync(path)
      ? realpathSync(path)
      : join(realpathSync(dirname(path)), basename(path));
    const location = relative(git.root, actualPath);
    this.safePrivateState = location.startsWith("../") || isAbsolute(location);
    this.db = new DatabaseSync(path);
    chmodSync(path, 0o600);
    this.db.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS files(path TEXT PRIMARY KEY,content TEXT);
      CREATE TABLE IF NOT EXISTS history(id TEXT,revision TEXT PRIMARY KEY,content TEXT,seq INTEGER);
      CREATE TABLE IF NOT EXISTS bindings(site TEXT,page TEXT,id TEXT UNIQUE,visible INTEGER DEFAULT 0,checked INTEGER DEFAULT 0,migrated INTEGER DEFAULT 0,PRIMARY KEY(site,page));
      CREATE TABLE IF NOT EXISTS state(key TEXT PRIMARY KEY,value TEXT);`);
  }
  initialize() {
    this.git.initialize();
  }
  read(path: string) {
    const row = this.db
      .prepare("SELECT content FROM files WHERE path=?")
      .get(path) as { content: string | null } | undefined;
    return row ? row.content : this.git.read(path);
  }
  files(dir: string) {
    const paths = this.db
      .prepare("SELECT path,content FROM files WHERE path LIKE ?")
      .all(dir + "/%") as { path: string; content: string | null }[];
    const files = new Set(this.git.files(dir));
    for (const row of paths) {
      if (row.content === null) files.delete(row.path);
      else files.add(row.path);
    }
    const hidden = new Set(
      this.bindings()
        .filter(
          (b) =>
            !b.migrated &&
            (!this.safePrivateState ||
              !b.visible ||
              Date.now() - b.checked > 15 * 60_000),
        )
        .map((b) => b.id),
    );
    return [...files].filter(
      (path) => !path.startsWith("records/") || !hidden.has(path.slice(8, -3)),
    );
  }
  bindings() {
    return this.db.prepare("SELECT * FROM bindings").all() as unknown as {
      site: string;
      page: string;
      id: string;
      visible: number;
      checked: number;
      migrated: number;
    }[];
  }
  bind(site: string, page: string, id: string) {
    this.db
      .prepare("INSERT OR IGNORE INTO bindings(site,page,id) VALUES(?,?,?)")
      .run(site, page, id);
    return this.bindings().find((b) => b.site === site && b.page === page)!;
  }
  availability(id: string, visible: boolean) {
    this.db
      .prepare("UPDATE bindings SET visible=?,checked=? WHERE id=?")
      .run(visible ? 1 : 0, Date.now(), id);
  }
  state<T>(key: string): T | undefined {
    const row = this.db
      .prepare("SELECT value FROM state WHERE key=?")
      .get(key) as { value: string } | undefined;
    return row ? JSON.parse(row.value) : undefined;
  }
  setState(key: string, value: unknown) {
    this.db
      .prepare("INSERT OR REPLACE INTO state VALUES(?,?)")
      .run(key, JSON.stringify(value));
  }
  transaction(changes: Change[], message: string) {
    const ids = this.bindings()
      .filter((b) => !b.migrated)
      .map((b) => b.id);
    const privateChange = changes.some(
      (c) =>
        this.db.prepare("SELECT 1 FROM files WHERE path=?").get(c.path) ||
        ids.some((id) => c.path.includes(id) || c.content?.includes(id)),
    );
    if (!privateChange) {
      this.git.transaction(changes, message);
      return;
    }
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const c of changes) {
        demand(
          !c.path.startsWith("/") && !c.path.split(/[\\/]/).includes(".."),
          400,
          "Unsafe storage path",
        );
        this.db
          .prepare("INSERT OR REPLACE INTO files VALUES(?,?)")
          .run(c.path, c.content);
        if (c.path.startsWith("records/") && c.content) {
          const u = decode(c.content);
          this.db
            .prepare("INSERT OR IGNORE INTO history VALUES(?,?,?,?)")
            .run(u.id, u.revision, c.content, Date.now());
        }
      }
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  units() {
    return this.files("records")
      .filter((p) => p.endsWith(".md"))
      .map((p) => decode(this.read(p)!));
  }
  history(id: string) {
    const local = (
      this.db
        .prepare(
          "SELECT content FROM history WHERE id=? ORDER BY seq DESC,rowid DESC",
        )
        .all(id) as { content: string }[]
    ).map((r) => decode(r.content));
    const combined = [...local, ...this.git.history(id)];
    const current = this.units().find((u) => u.id === id);
    combined.sort(
      (a, b) =>
        Number(b.revision === current?.revision) -
        Number(a.revision === current?.revision),
    );
    return combined.filter(
      (r, i) => combined.findIndex((x) => x.revision === r.revision) === i,
    );
  }
  migrate(unit: Unit) {
    this.git.transaction(
      [{ path: `records/${unit.id}.md`, content: encode(unit) }],
      "Titan: move Confluence page to Titan",
    );
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db
        .prepare("DELETE FROM files WHERE path=?")
        .run(`records/${unit.id}.md`);
      this.db.prepare("UPDATE bindings SET migrated=1 WHERE id=?").run(unit.id);
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  hiddenIds() {
    return new Set(
      this.bindings()
        .filter(
          (b) =>
            !b.migrated &&
            (!this.safePrivateState ||
              !b.visible ||
              Date.now() - b.checked > 15 * 60_000),
        )
        .map((b) => b.id),
    );
  }
  sync() {
    return this.git.sync();
  }
  close() {
    this.db.close();
  }
}
