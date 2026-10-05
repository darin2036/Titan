import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  rmSync,
  readdirSync,
  realpathSync,
} from "node:fs";
import { resolve, dirname, relative, isAbsolute } from "node:path";
import {
  UnitSchema,
  type Unit,
  type RecordView,
  type Settings,
  RelationTypes,
  hash,
  uid,
  Fault,
  demand,
} from "./contracts.ts";
export type Change = { path: string; content: string | null };
export interface StorageAdapter {
  root: string;
  initialize(): void;
  read(path: string): string | null;
  files(dir: string): string[];
  transaction(changes: Change[], message: string): void;
  units(): RecordView[];
  history(id: string): RecordView[];
  sync(): string;
}
export function encode(unit: Unit) {
  const { body, ...header } = unit;
  delete (header as any).revision;
  return `---\n${JSON.stringify(header, null, 2)}\n---\n${body}\n`;
}
export function decode(content: string): RecordView {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  demand(match, 422, "Record requires a structured JSON frontmatter header");
  const unit = UnitSchema.parse({
    ...JSON.parse(match[1]),
    body: match[2].replace(/\n$/, ""),
  });
  return { ...unit, revision: hash(content) };
}
export class GitStorage implements StorageAdapter {
  root: string;
  constructor(root: string) {
    mkdirSync(root, { recursive: true });
    this.root = realpathSync(root);
  }
  git(...args: string[]) {
    return execFileSync("git", ["-C", this.root, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 10_000_000,
    }).trim();
  }
  private path(path: string) {
    demand(
      !isAbsolute(path) && !path.split(/[\\/]/).includes(".."),
      400,
      "Unsafe storage path",
    );
    const file = resolve(this.root, path);
    let parent = dirname(file);
    while (!existsSync(parent)) parent = dirname(parent);
    const rel = relative(this.root, realpathSync(parent));
    demand(
      !rel.startsWith("..") && !isAbsolute(rel),
      400,
      "Storage symlink leaves workspace",
    );
    if (existsSync(file))
      demand(
        realpathSync(file) === file,
        400,
        "Storage symlinks are not supported",
      );
    return file;
  }
  initialize() {
    if (!existsSync(resolve(this.root, ".git"))) this.git("init");
    this.recover();
    if (this.read(".titan/workspace.json")) return;
    const settings: Settings = {
      schemaVersion: 1,
      deploymentId: uid(),
      autonomy: "bounded",
      provider: "fixture",
      model: "fixture-v1",
      credentialRef: "OPENAI_API_KEY",
      providerBaseUrl: "",
      embeddingModel: "",
      activeModel: "baseline-v1",
      previousModel: null,
      webhookUrl: "",
      relationshipTypes: RelationTypes,
    };
    this.transaction(
      [
        {
          path: ".titan/workspace.json",
          content: JSON.stringify(settings, null, 2) + "\n",
        },
        { path: "records/.gitkeep", content: "" },
      ],
      "Initialize Titan workspace",
    );
  }
  read(path: string) {
    const file = this.path(path);
    return existsSync(file) ? readFileSync(file, "utf8") : null;
  }
  files(dir: string): string[] {
    const path = this.path(dir);
    if (!existsSync(path)) return [];
    return readdirSync(path, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory()
        ? this.files(`${dir}/${e.name}`)
        : e.isFile()
          ? [`${dir}/${e.name}`]
          : [],
    );
  }
  transaction(changes: Change[], message: string) {
    demand(changes.length > 0, 400, "Empty transaction");
    demand(
      !this.git("diff", "--cached", "--name-only"),
      409,
      "Commit or unstage existing changes before Titan writes",
    );
    const prior = changes.map((c) => ({
      path: c.path,
      content: this.read(c.path),
    }));
    const journal = joinGit(
      this.git("rev-parse", "--absolute-git-dir"),
      "titan-transaction.json",
    );
    let head = "";
    try {
      head = this.git("rev-parse", "HEAD");
    } catch {}
    writeFileSync(journal, JSON.stringify({ head, prior, changes }));
    try {
      for (const c of changes) {
        const file = this.path(c.path);
        mkdirSync(dirname(file), { recursive: true });
        if (c.content === null) rmSync(file, { force: true });
        else {
          writeFileSync(file + ".tmp", c.content);
          renameSync(file + ".tmp", file);
        }
      }
      this.git("add", "--", ...changes.map((c) => c.path));
      if (this.git("diff", "--cached", "--name-only"))
        this.git(
          "-c",
          "user.name=Titan",
          "-c",
          "user.email=titan@localhost",
          "commit",
          "-m",
          message,
        );
    } catch (error) {
      try {
        this.git("reset", "--", ...changes.map((c) => c.path));
      } catch {}
      for (const c of prior) {
        const f = this.path(c.path);
        if (c.content === null) rmSync(f, { force: true });
        else writeFileSync(f, c.content);
      }
      throw new Fault(
        409,
        `Git transaction failed: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    } finally {
      rmSync(journal, { force: true });
    }
  }
  private recover() {
    const journal = joinGit(
      this.git("rev-parse", "--absolute-git-dir"),
      "titan-transaction.json",
    );
    if (!existsSync(journal)) return;
    const data = JSON.parse(readFileSync(journal, "utf8")) as {
      head: string;
      prior: Change[];
      changes: Change[];
    };
    let head = "";
    try {
      head = this.git("rev-parse", "HEAD");
    } catch {}
    if (head === data.head) {
      try {
        this.git("reset", "--", ...data.changes.map((c) => c.path));
      } catch {}
      for (const c of data.prior) {
        const file = this.path(c.path);
        if (c.content === null) rmSync(file, { force: true });
        else {
          mkdirSync(dirname(file), { recursive: true });
          writeFileSync(file, c.content);
        }
      }
    }
    rmSync(journal, { force: true });
  }
  units() {
    const values = this.files("records")
      .filter((f) => f.endsWith(".md"))
      .map((f) => decode(this.read(f)!));
    const ids = new Set();
    for (const u of values) {
      demand(!ids.has(u.id), 422, "Duplicate record identity");
      ids.add(u.id);
    }
    return values;
  }
  unitPath(id: string) {
    return (
      this.files("records")
        .filter((f) => f.endsWith(".md"))
        .find((f) => {
          try {
            return decode(this.read(f)!).id === id;
          } catch {
            return false;
          }
        }) ?? `records/${id}.md`
    );
  }
  history(id: string) {
    const path = this.unitPath(id);
    return this.git("log", "--format=%H", "--follow", "--", path)
      .split("\n")
      .filter(Boolean)
      .flatMap((commit) => {
        const files = this.git(
          "ls-tree",
          "-r",
          "--name-only",
          commit,
          "--",
          "records",
        )
          .split("\n")
          .filter((f) => f.endsWith(".md"));
        for (const file of files) {
          try {
            const unit = decode(
              execFileSync(
                "git",
                ["-C", this.root, "show", `${commit}:${file}`],
                { encoding: "utf8", maxBuffer: 1_000_000 },
              ),
            );
            if (unit.id === id) return [unit];
          } catch {}
        }
        return [];
      });
  }
  sync() {
    demand(
      !this.git("status", "--porcelain"),
      409,
      "Commit or reconcile working-tree changes before publishing",
    );
    demand(
      this.git("remote", "get-url", "origin"),
      400,
      "No origin remote configured",
    );
    this.git("fetch", "origin");
    const branch = "titan/workspace";
    let found = false;
    try {
      this.git("rev-parse", `refs/remotes/origin/${branch}`);
      found = true;
    } catch {}
    if (found) {
      try {
        this.git("merge", "--ff-only", `origin/${branch}`);
      } catch {
        throw new Fault(
          409,
          "Workspace branches diverged; resolve the conflict before publishing",
        );
      }
    }
    try {
      this.git("push", "origin", `HEAD:refs/heads/${branch}`);
    } catch {
      throw new Fault(
        409,
        "Remote publication failed; local records are preserved",
      );
    }
    return branch;
  }
}
const joinGit = (dir: string, file: string) => resolve(dir, file);
