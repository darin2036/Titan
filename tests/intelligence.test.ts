import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { once } from "node:events";
import { GitStorage } from "../apps/server/src/storage.ts";
import { Index } from "../apps/server/src/index.ts";
import { Domain, OWNER, INFERENCE } from "../apps/server/src/domain.ts";
import { Intelligence } from "../apps/server/src/intelligence.ts";
import { uid, hash, type RecordView } from "../apps/server/src/contracts.ts";
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "titan-jobs-"));
  const domain = new Domain(
    new GitStorage(join(dir, "repo")),
    new Index(join(dir, "state.sqlite")),
  );
  const intelligence = new Intelligence(domain, join(dir, "state"));
  return {
    dir,
    domain,
    intelligence,
    close() {
      domain.index.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
test("stale inference is discarded and reevaluation is queued", async () => {
  const t = fixture();
  try {
    const a = t.domain.create(OWNER, {
      kind: "knowledge",
      title: "A",
      body: "A",
    }) as RecordView;
    const b = t.domain.create(OWNER, {
      kind: "knowledge",
      title: "B",
      body: "B",
    }) as RecordView;
    t.intelligence.call = async () => {
      t.domain.edit(OWNER, a.id, a.revision, {
        body: "Changed during inference",
      });
      return {
        version: 1,
        model: "fixture-v1",
        policyVersion: "inference-v1",
        proposals: [
          {
            source: a.id,
            target: b.id,
            type: "supports",
            justification: "Stale result",
            evidence: [],
          },
        ],
      };
    };
    await t.intelligence.infer({
      ids: [a.id],
      revisions: { [a.id]: a.revision },
    });
    assert.equal(t.domain.assertions(INFERENCE).length, 0);
    assert.ok(t.domain.audit(OWNER).some((e) => e.outcome === "stale"));
  } finally {
    t.close();
  }
});
test("webhooks are signed and failures use bounded retries", async () => {
  const t = fixture();
  const receiver = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      assert.ok(req.headers["x-titan-signature"]);
      assert.ok(req.headers["x-titan-timestamp"]);
      assert.equal(JSON.parse(body).type, "work.ready");
      res.writeHead(200);
      res.end("{}");
    });
  });
  receiver.listen(0, "127.0.0.1");
  await once(receiver, "listening");
  const address = receiver.address() as { port: number };
  process.env.TITAN_WEBHOOK_SECRET = "test-only-secret";
  try {
    t.domain.updateSettings(OWNER, {
      webhookUrl: `http://127.0.0.1:${address.port}`,
    });
    const work = t.domain.create(OWNER, {
      kind: "work",
      title: "Build",
      body: "Build",
      status: "ready",
    }) as RecordView;
    const job = t.domain.index.db
      .prepare("SELECT * FROM jobs WHERE kind='webhook'")
      .get() as { id: string; payload: string };
    await t.intelligence.deliver(job.id, JSON.parse(job.payload));
    t.intelligence.call = async () => {
      throw new Error("unavailable");
    };
    for (let i = 0; i < 3; i++) {
      t.domain.index.db.prepare("UPDATE jobs SET next_at=0").run();
      await t.intelligence.tick();
    }
    assert.ok(t.domain.index.jobs().some((j) => j.status === "failed"));
  } finally {
    delete process.env.TITAN_WEBHOOK_SECRET;
    receiver.close();
    t.close();
  }
});
test("model activation requires owner, evaluation and active deployment sources", async () => {
  const t = fixture();
  try {
    const u = t.domain.create(OWNER, {
      kind: "knowledge",
      title: "A",
      body: "A",
    }) as RecordView;
    t.intelligence.call = async () => ({
      version: 1,
      weights: { authority: 2, supported: 1, lexical: 1 },
      checksum: hash(
        JSON.stringify({ authority: 2, lexical: 1, supported: 1 }),
      ),
      evaluation: { passed: true, suite: "test", correct: 4, total: 4 },
    });
    const model = await t.intelligence.evaluate();
    assert.throws(() => t.domain.activate(INFERENCE, model.id), /human/);
    t.domain.activate(OWNER, model.id);
    assert.equal(t.domain.settings().activeModel, model.id);
    t.domain.rollback(OWNER);
    assert.equal(t.domain.settings().activeModel, "baseline-v1");
    t.domain.remove(INFERENCE, u.id, u.revision, "Removed");
    assert.throws(() => t.domain.activate(OWNER, model.id), /removed/);
  } finally {
    t.close();
  }
});
test("removal during ranking cannot leak a stale context result", async () => {
  const t = fixture();
  try {
    const u = t.domain.create(OWNER, {
      kind: "knowledge",
      title: "Authentication",
      body: "identity",
    }) as RecordView;
    t.intelligence.call = async () => {
      t.domain.remove(INFERENCE, u.id, u.revision, "Removed during ranking");
      return { ids: [u.id] };
    };
    assert.equal(
      (await t.intelligence.context("identity", [], INFERENCE)).length,
      0,
    );
  } finally {
    t.close();
  }
});
