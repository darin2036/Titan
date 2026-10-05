import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  renameSync,
  mkdirSync,
  symlinkSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitStorage, encode } from "../apps/server/src/storage.ts";
import { Index } from "../apps/server/src/index.ts";
import { Domain, OWNER, INFERENCE } from "../apps/server/src/domain.ts";
import { uid, type RecordView, hash } from "../apps/server/src/contracts.ts";
import { seedDemo } from "../apps/server/src/demo.ts";
import { execFileSync } from "node:child_process";
function setup() {
  const dir = mkdtempSync(join(tmpdir(), "titan-test-"));
  const storage = new GitStorage(join(dir, "repo"));
  const index = new Index(join(dir, "state.sqlite"));
  const domain = new Domain(storage, index);
  return {
    dir,
    storage,
    index,
    domain,
    close() {
      index.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
function create(
  d: Domain,
  kind = "knowledge",
  extra: Record<string, unknown> = {},
): RecordView {
  return d.create(OWNER, {
    kind,
    title: "Authentication policy",
    body: "Services use identity.",
    ...extra,
  }) as RecordView;
}
test("initialization preserves unrelated files and is idempotent", () => {
  const dir = mkdtempSync(join(tmpdir(), "titan-init-"));
  writeFileSync(join(dir, "README.md"), "existing");
  const s = new GitStorage(dir);
  s.initialize();
  const head = s.git("rev-parse", "HEAD");
  s.initialize();
  assert.equal(head, s.git("rev-parse", "HEAD"));
  assert.equal(readFileSync(join(dir, "README.md"), "utf8"), "existing");
  rmSync(dir, { recursive: true, force: true });
});
test("identities survive file moves and indexes rebuild", () => {
  const t = setup();
  try {
    const u = create(t.domain);
    renameSync(
      join(t.storage.root, `records/${u.id}.md`),
      join(t.storage.root, "records", "renamed.md"),
    );
    t.domain.reconcile();
    assert.equal(t.domain.get(OWNER, u.id).revision, u.revision);
    t.index.db.exec("DELETE FROM units; DELETE FROM search");
    t.domain.reconcile();
    assert.equal(t.domain.context(INFERENCE, "identity")[0].id, u.id);
  } finally {
    t.close();
  }
});
test("stale writes cannot overwrite revisions", () => {
  const t = setup();
  try {
    const u = create(t.domain);
    const next = t.domain.edit(OWNER, u.id, u.revision, {
      body: "Changed",
    }) as RecordView;
    assert.notEqual(next.revision, u.revision);
    assert.throws(
      () => t.domain.edit(OWNER, u.id, u.revision, { body: "Lost change" }),
      /refresh/,
    );
    assert.equal(t.domain.get(OWNER, u.id).body, "Changed");
  } finally {
    t.close();
  }
});
test("accepted knowledge changes require review from bounded agents", () => {
  const t = setup();
  try {
    const u = create(t.domain, "decision", {
      authority: "approved",
      status: "accepted",
    });
    const result = t.domain.edit(INFERENCE, u.id, u.revision, {
      body: "Different policy",
    });
    assert.ok("reviewId" in result);
    assert.equal(t.domain.get(OWNER, u.id).body, u.body);
    t.domain.review(OWNER, (result as any).reviewId, true);
    assert.equal(t.domain.get(OWNER, u.id).body, "Different policy");
  } finally {
    t.close();
  }
});
test("full mode permits consequential mutations but cannot restore or change policy", () => {
  const t = setup();
  try {
    t.domain.updateSettings(OWNER, { autonomy: "full" });
    const u = create(t.domain);
    const r = t.domain.edit(INFERENCE, u.id, u.revision, {
      authority: "approved",
    }) as RecordView;
    assert.equal(r.authority, "approved");
    const removed = t.domain.remove(
      INFERENCE,
      u.id,
      r.revision,
      "No longer used",
    );
    assert.throws(
      () => t.domain.restore(INFERENCE, u.id, removed.revision),
      /human/,
    );
    assert.throws(
      () => t.domain.updateSettings(INFERENCE, { autonomy: "bounded" }),
      /human/,
    );
  } finally {
    t.close();
  }
});
test("removed records disappear from agent reads, history, search, graph and datasets", () => {
  const t = setup();
  try {
    const u = create(t.domain);
    const b = create(t.domain, "work");
    t.domain.relate(INFERENCE, {
      source: b.id,
      target: u.id,
      type: "implements",
      evidence: [],
      revisions: { [u.id]: u.revision, [b.id]: b.revision },
      justification: "Work uses policy",
    });
    t.domain.feedback(OWNER, {
      type: "retrieval",
      label: "useful",
      entities: [u.id],
      justification: "Useful",
    });
    t.domain.remove(INFERENCE, u.id, u.revision, "Out of scope");
    assert.throws(() => t.domain.get(INFERENCE, u.id), /unavailable/);
    assert.throws(() => t.domain.history(INFERENCE, u.id), /unavailable/);
    assert.throws(() => t.domain.records(INFERENCE, true), /human/);
    assert.ok(
      !t.domain.context(INFERENCE, "identity").some((r) => r.id === u.id),
    );
    assert.equal(t.domain.assertions(INFERENCE).length, 0);
    assert.equal(t.domain.dataset(OWNER).labels.length, 0);
    assert.ok(t.domain.history(OWNER, u.id).length);
    assert.equal(
      t.index.db.prepare("SELECT count(*) n FROM search WHERE id=?").get(u.id)
        ?.n,
      0,
    );
  } finally {
    t.close();
  }
});
test("restoration does not revive old assertions or establish validity", () => {
  const t = setup();
  try {
    const u = create(t.domain);
    const r = t.domain.remove(INFERENCE, u.id, u.revision, "No longer used");
    const restored = t.domain.restore(OWNER, u.id, r.revision);
    assert.equal(restored.validity, "unverified");
    assert.equal(t.domain.get(INFERENCE, u.id).lifecycle, "active");
  } finally {
    t.close();
  }
});
test("supersession is reviewed, auditable and changes retrieval", () => {
  const t = setup();
  try {
    seedDemo(t.domain);
    const review = t.domain
      .reviews(OWNER)
      .relationships.find((a) => a.type === "supersedes")!;
    assert.ok(review);
    t.domain.review(OWNER, review.id, true);
    const context = t.domain.context(INFERENCE, "authentication", [
      "production",
    ]);
    const old = context.find((u) => u.id === review.target)!;
    assert.equal(old.usableAsBasis, false);
    assert.equal(old.validity, "superseded");
    assert.ok(old.warnings.some((w) => w.includes("Superseded")));
    assert.ok(t.domain.audit(OWNER).some((e) => e.operation === "review"));
  } finally {
    t.close();
  }
});
test("self-links, unknown types, stale proposals and cycles are rejected", () => {
  const t = setup();
  try {
    const a = create(t.domain),
      b = create(t.domain);
    const input = {
      source: a.id,
      target: b.id,
      type: "blocks",
      evidence: [],
      revisions: { [a.id]: a.revision, [b.id]: b.revision },
      justification: "Dependency",
    };
    t.domain.relate(INFERENCE, input);
    assert.throws(
      () =>
        t.domain.relate(INFERENCE, { ...input, source: b.id, target: a.id }),
      /cycle/,
    );
    assert.throws(
      () => t.domain.relate(INFERENCE, { ...input, target: a.id }),
      /Self/,
    );
    assert.throws(
      () => t.domain.relate(INFERENCE, { ...input, type: "unknown" }),
      /Unknown/,
    );
    const p = t.domain.relate(INFERENCE, { ...input, type: "contradicts" });
    t.domain.edit(OWNER, a.id, a.revision, { body: "Revision" });
    assert.throws(() => t.domain.review(OWNER, p.id, true), /stale/);
  } finally {
    t.close();
  }
});
test("completion needs accepted verified evidence, not an agent declaration", () => {
  const t = setup();
  try {
    const w = create(t.domain, "work"),
      e = create(t.domain, "evidence");
    t.domain.relate(INFERENCE, {
      source: e.id,
      target: w.id,
      type: "supports",
      evidence: [e.id],
      revisions: { [e.id]: e.revision, [w.id]: w.revision },
      justification: "Reported result",
    });
    assert.throws(
      () => t.domain.edit(OWNER, w.id, w.revision, { status: "completed" }),
      /evidence/,
    );
    t.domain.edit(OWNER, e.id, e.revision, {
      status: "accepted",
      validity: "supported",
    });
    const next = t.domain.edit(OWNER, w.id, w.revision, {
      status: "completed",
    }) as RecordView;
    assert.equal(next.status, "completed");
  } finally {
    t.close();
  }
});
test("malformed records are quarantined and external edits get provenance", () => {
  const t = setup();
  try {
    const u = create(t.domain);
    writeFileSync(
      join(t.storage.root, `records/${u.id}.md`),
      encode({ ...u, body: "external" }),
    );
    writeFileSync(join(t.storage.root, "records", "invalid.md"), "bad file");
    t.domain.reconcile();
    assert.equal(t.domain.issues.length, 1);
    assert.equal(t.domain.get(OWNER, u.id).body, "external");
    assert.ok(
      t.domain.audit(OWNER).some((e) => e.operation === "external_edit"),
    );
    assert.equal(
      readFileSync(join(t.storage.root, "records", "invalid.md"), "utf8"),
      "bad file",
    );
  } finally {
    t.close();
  }
});
test("storage rejects escapes and preserves existing staged changes", () => {
  const t = setup();
  try {
    assert.throws(() => t.storage.read("../secret"), /Unsafe/);
    const elsewhere = join(t.dir, "elsewhere");
    mkdirSync(elsewhere);
    symlinkSync(elsewhere, join(t.storage.root, "link"));
    assert.throws(() => t.storage.read("link/private"), /symlink/);
    writeFileSync(join(t.storage.root, "other.txt"), "unrelated");
    t.storage.git("add", "other.txt");
    assert.throws(() => create(t.domain), /unstage/);
    assert.ok(
      t.storage.git("diff", "--cached", "--name-only").includes("other.txt"),
    );
  } finally {
    t.close();
  }
});
test("justifications and extension keys are bounded and validated", () => {
  const t = setup();
  try {
    const u = create(t.domain);
    assert.throws(() =>
      t.domain.remove(INFERENCE, u.id, u.revision, "x".repeat(601)),
    );
    assert.throws(() =>
      create(t.domain, "knowledge", { extensions: { unscoped: true } }),
    );
    assert.ok(
      create(t.domain, "knowledge", {
        extensions: { "example:category": "policy" },
      }).id,
    );
  } finally {
    t.close();
  }
});
test("dataset manifests record revisions and do not cross deployments", () => {
  const a = setup(),
    b = setup();
  try {
    const u = create(a.domain);
    a.domain.feedback(OWNER, {
      type: "human_correction",
      label: "approved",
      entities: [u.id],
      justification: "Reviewed",
    });
    const manifest = a.domain.dataset(OWNER);
    assert.equal(manifest.labels[0].revisions[u.id], u.revision);
    assert.equal(b.domain.dataset(OWNER).labels.length, 0);
    assert.notEqual(
      a.domain.settings().deploymentId,
      b.domain.settings().deploymentId,
    );
  } finally {
    a.close();
    b.close();
  }
});
test("agents cannot mislabel their feedback as human correction or verification", () => {
  const t = setup();
  try {
    const u = create(t.domain);
    for (const type of [
      "human_correction",
      "accepted_proposal",
      "rejected_proposal",
      "verified_outcome",
    ])
      assert.throws(
        () =>
          t.domain.feedback(INFERENCE, {
            type,
            label: "approved",
            entities: [u.id],
            justification: "Claim",
          }),
        /human/,
      );
    assert.ok(
      t.domain.feedback(INFERENCE, {
        type: "reported_outcome",
        label: "checks passed",
        entities: [u.id],
        justification: "Agent report",
      }).id,
    );
  } finally {
    t.close();
  }
});
test("pending jobs survive restart and interrupted jobs return to pending", () => {
  const t = setup();
  try {
    create(t.domain);
    const job = t.index.jobs()[0];
    t.index.db
      .prepare("UPDATE jobs SET status='running' WHERE id=?")
      .run(job.id);
    t.index.close();
    const next = new Index(join(t.dir, "state.sqlite"));
    assert.equal(next.jobs()[0].status, "pending");
    next.close();
  } finally {
    rmSync(t.dir, { recursive: true, force: true });
  }
});
test("outcome deduplication survives loss of the SQLite projection", () => {
  const t = setup();
  try {
    const work = create(t.domain, "work");
    const request = {
      eventId: uid(),
      workId: work.id,
      revision: work.revision,
      title: "External checks",
      body: "Reported checks passed",
      verified: true,
    };
    const first = t.domain.outcome(INFERENCE, request);
    t.index.close();
    const nextIndex = new Index(join(t.dir, "rebuilt.sqlite"));
    const restarted = new Domain(t.storage, nextIndex);
    assert.equal(restarted.outcome(INFERENCE, request).id, first.id);
    assert.equal(
      restarted.records(OWNER).filter((u) => u.kind === "evidence").length,
      1,
    );
    nextIndex.close();
  } finally {
    rmSync(t.dir, { recursive: true, force: true });
  }
});
test("source-bound summaries and vectors invalidate on revision or removal", () => {
  const t = setup();
  try {
    const source = create(t.domain);
    const summary = create(t.domain, "knowledge", {
      body: "Derived summary of identity.",
      extensions: { "titan:sources": { [source.id]: source.revision } },
    });
    t.index.db
      .prepare("INSERT INTO vectors VALUES(?,?,?,?)")
      .run(summary.id, summary.revision, "test", "[1,0]");
    assert.ok(t.domain.get(INFERENCE, summary.id));
    t.domain.edit(OWNER, source.id, source.revision, {
      body: "Changed source",
    });
    assert.throws(() => t.domain.get(INFERENCE, summary.id), /unavailable/);
    assert.equal(
      t.index.db
        .prepare("SELECT count(*) n FROM search WHERE id=?")
        .get(summary.id)?.n,
      0,
    );
    assert.equal(
      t.index.db
        .prepare("SELECT count(*) n FROM vectors WHERE id=?")
        .get(summary.id)?.n,
      0,
    );
    assert.ok(t.domain.get(OWNER, summary.id, true));
  } finally {
    t.close();
  }
});
test("interrupted uncommitted transactions recover their prior contents", () => {
  const t = setup();
  try {
    const u = create(t.domain);
    const path = `records/${u.id}.md`;
    const prior = t.storage.read(path);
    const head = t.storage.git("rev-parse", "HEAD");
    writeFileSync(
      join(t.storage.root, ".git", "titan-transaction.json"),
      JSON.stringify({
        head,
        prior: [{ path, content: prior }],
        changes: [{ path, content: "partial" }],
      }),
    );
    writeFileSync(join(t.storage.root, path), "partial");
    const recovered = new GitStorage(t.storage.root);
    recovered.initialize();
    assert.equal(recovered.read(path), prior);
  } finally {
    t.close();
  }
});
test("Git publication uses a dedicated branch and refuses divergence", () => {
  const t = setup();
  try {
    const remote = join(t.dir, "remote.git");
    execFileSync("git", ["init", "--bare", remote], { stdio: "ignore" });
    t.storage.git("remote", "add", "origin", remote);
    create(t.domain);
    assert.equal(t.storage.sync(), "titan/workspace");
    const clone = join(t.dir, "other");
    execFileSync(
      "git",
      ["clone", "--branch", "titan/workspace", remote, clone],
      { stdio: "ignore" },
    );
    writeFileSync(join(clone, "other.txt"), "remote edit");
    execFileSync("git", ["-C", clone, "add", "."]);
    execFileSync(
      "git",
      [
        "-C",
        clone,
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@local",
        "commit",
        "-m",
        "Remote change",
      ],
      { stdio: "ignore" },
    );
    execFileSync("git", ["-C", clone, "push"], { stdio: "ignore" });
    create(t.domain, "knowledge", { title: "Local divergence" });
    assert.throws(() => t.storage.sync(), /diverged/);
    assert.equal(t.domain.records(OWNER).length, 2);
  } finally {
    t.close();
  }
});
