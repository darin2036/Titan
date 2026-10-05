import { createHmac } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Domain, INFERENCE, OWNER } from "./domain.ts";
import {
  InferenceResultSchema,
  Fault,
  uid,
  now,
  hash,
  demand,
  type RecordView,
} from "./contracts.ts";
export class Intelligence {
  busy = false;
  lastScan = 0;
  constructor(
    public domain: Domain,
    public stateDir: string,
    public url = process.env.TITAN_INTELLIGENCE_URL ?? "http://127.0.0.1:4311",
  ) {}
  async call(path: string, payload: unknown) {
    const res = await fetch(this.url + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.TITAN_INTELLIGENCE_TOKEN ?? ""}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(100_000),
    });
    const data = (await res.json()) as any;
    if (!res.ok)
      throw new Fault(
        res.status,
        data.error ?? "Intelligence service unavailable",
      );
    return data;
  }
  async author(input: {
    instruction: string;
    kind: string;
    record?: RecordView;
    selection?: string;
  }) {
    return this.call("/v1/author", {
      ...input,
      config: this.domain.settings(),
    });
  }
  async context(
    query: string,
    scope: string[],
    principal: Parameters<Domain["context"]>[0],
  ) {
    this.domain.records(principal);
    const settings = this.domain.settings();
    let semanticIds: string[] = [];
    if (settings.embeddingModel && query.trim()) {
      try {
        const response = await this.call("/v1/embed", {
          records: [
            {
              id: "query",
              revision: "query",
              lifecycle: "active",
              title: query,
              body: "",
            },
          ],
          model: settings.embeddingModel,
        });
        semanticIds = this.domain.index.nearest(
          response.vectors[0].values,
          settings.embeddingModel,
        );
      } catch {
        /* Full-text and graph retrieval remain available. */
      }
    }
    const candidates = this.domain.context(
      principal,
      query,
      scope,
      semanticIds,
    );
    const fresh = () => {
      const current = new Map(
        this.domain.records(principal).map((u) => [u.id, u.revision]),
      );
      return candidates.filter((u) => current.get(u.id) === u.revision);
    };
    if (!candidates.length) return candidates;
    let weights;
    const artifact = this.domain
      .objects<any>("models")
      .find((m) => m.id === settings.activeModel);
    const active = new Set(this.domain.records(principal).map((u) => u.id));
    if (artifact && artifact.sourceIds.every((id: string) => active.has(id)))
      weights = artifact.weights;
    try {
      const ranked = await this.call("/v1/rank", {
        records: candidates,
        query,
        weights,
        model: weights ? settings.activeModel : "baseline-v1",
      });
      const map = new Map(candidates.map((u) => [u.id, u]));
      const ids = [...new Set<string>(ranked.ids)].filter((id) => map.has(id));
      demand(
        ids.length === map.size,
        502,
        "Ranking response omitted candidates",
      );
      const eligible = new Set(fresh().map((u) => u.id));
      return ids.filter((id) => eligible.has(id)).map((id) => map.get(id)!);
    } catch {
      return fresh();
    }
  }
  async evaluate() {
    const manifest = this.domain.dataset(OWNER);
    const result = await this.call("/v1/evaluate", {
      weights: { authority: 2, supported: 1, lexical: 1 },
    });
    const id = uid();
    const artifact = {
      schemaVersion: 1,
      id,
      deploymentId: manifest.deploymentId,
      datasetId: manifest.id,
      sourceIds: Object.keys(manifest.sourceRevisions),
      createdAt: now(),
      kind: "baseline-ranker",
      ...result,
    };
    mkdirSync(join(this.stateDir, "artifacts"), { recursive: true });
    writeFileSync(
      join(this.stateDir, "artifacts", `${id}.json`),
      JSON.stringify(result),
    );
    this.domain.storage.transaction(
      [
        {
          path: `.titan/models/${id}.json`,
          content: JSON.stringify(artifact, null, 2) + "\n",
        },
      ],
      "Titan: evaluate ranking candidate",
    );
    this.domain.log(
      OWNER,
      "evaluate_model",
      [],
      "Deterministic baseline evaluated; no custom training",
      "evaluated",
    );
    return artifact;
  }
  async tick() {
    if (this.busy) return;
    this.busy = true;
    const db = this.domain.index.db;
    try {
      if (Date.now() - this.lastScan > 3000) {
        this.domain.reconcile();
        this.domain.restoreJobs();
        this.lastScan = Date.now();
      }
      const job = db
        .prepare(
          "SELECT * FROM jobs WHERE status='pending' AND next_at<=? ORDER BY rowid LIMIT 1",
        )
        .get(Date.now()) as
        | { id: string; kind: string; payload: string; attempts: number }
        | undefined;
      if (!job) return;
      db.prepare("UPDATE jobs SET status='running' WHERE id=?").run(job.id);
      try {
        const payload = JSON.parse(job.payload);
        if (job.kind === "infer") await this.infer(payload);
        else if (job.kind === "webhook") await this.deliver(job.id, payload);
        else if (job.kind === "evaluate")
          this.domain.log(
            INFERENCE,
            "reevaluate_models",
            [],
            "Sources removed; affected ranking artifacts fall back to baseline",
            "queued",
          );
        db.prepare("UPDATE jobs SET status='done',error=NULL WHERE id=?").run(
          job.id,
        );
      } catch (error) {
        const attempts = job.attempts + 1;
        const retry = attempts < 3;
        db.prepare(
          "UPDATE jobs SET status=?,attempts=?,next_at=?,error=? WHERE id=?",
        ).run(
          retry ? "pending" : "failed",
          attempts,
          Date.now() + 1000 * 2 ** attempts,
          error instanceof Fault
            ? error.message
            : "Service unavailable; retry or inspect configuration",
          job.id,
        );
        if (!retry)
          this.domain.log(
            INFERENCE,
            "job_failed",
            [],
            "Background operation exhausted three attempts",
            "failed",
          );
      }
    } finally {
      this.busy = false;
    }
  }
  async infer(payload: { ids: string[]; revisions: Record<string, string> }) {
    const all = this.domain.records(INFERENCE);
    const source = all.filter((r) => payload.ids.includes(r.id));
    if (!source.length) return;
    if (source.some((r) => r.revision !== payload.revisions[r.id])) {
      this.domain.index.enqueue(uid(), "infer", {
        ids: source.map((r) => r.id),
        revisions: Object.fromEntries(source.map((r) => [r.id, r.revision])),
      });
      return;
    }
    const candidates = [
      ...source,
      ...all.filter((r) => !payload.ids.includes(r.id)).slice(0, 40),
    ];
    const revisions = Object.fromEntries(
      candidates.map((r) => [r.id, r.revision]),
    );
    const settings = this.domain.settings();
    const result = InferenceResultSchema.parse(
      await this.call("/v1/infer", {
        version: 1,
        records: candidates,
        types: settings.relationshipTypes.map((t) => t.key),
        config: settings,
      }),
    );
    const latest = new Map(
      this.domain.records(INFERENCE).map((u) => [u.id, u.revision]),
    );
    if (candidates.some((u) => latest.get(u.id) !== u.revision)) {
      this.domain.index.enqueue(uid(), "infer", {
        ids: source.map((u) => u.id),
        revisions: Object.fromEntries(
          source.map((u) => [u.id, latest.get(u.id)]),
        ),
      });
      this.domain.log(
        INFERENCE,
        "inference",
        [],
        "Inputs changed; inference discarded",
        "stale",
        { model: result.model, policyVersion: result.policyVersion },
      );
      return;
    }
    for (const proposal of result.proposals)
      this.domain.relate(
        INFERENCE,
        { ...proposal, revisions },
        { model: result.model, policyVersion: result.policyVersion },
      );
    this.domain.log(
      INFERENCE,
      "inference",
      source,
      "Relationship inference completed",
      "completed",
      { model: result.model, policyVersion: result.policyVersion },
    );
    if (settings.embeddingModel) {
      const response = await this.call("/v1/embed", {
        records: source,
        model: settings.embeddingModel,
      });
      for (const vector of response.vectors) {
        const current = this.domain
          .records(INFERENCE)
          .find((u) => u.id === vector.id);
        if (
          current?.revision === vector.revision &&
          Array.isArray(vector.values) &&
          vector.values.every(
            (n: unknown) => typeof n === "number" && Number.isFinite(n),
          )
        )
          this.domain.index.db
            .prepare("INSERT OR REPLACE INTO vectors VALUES(?,?,?,?)")
            .run(
              vector.id,
              vector.revision,
              response.model,
              JSON.stringify(vector.values),
            );
      }
    }
  }
  async deliver(jobId: string, payload: { workId: string; revision: string }) {
    const settings = this.domain.settings();
    if (!settings.webhookUrl) return;
    const work = this.domain.get(INFERENCE, payload.workId);
    demand(
      work.revision === payload.revision && work.status === "ready",
      409,
      "Ready event is stale",
    );
    const secret = process.env.TITAN_WEBHOOK_SECRET;
    demand(secret, 422, "TITAN_WEBHOOK_SECRET must be configured");
    const timestamp = String(Date.now());
    const body = JSON.stringify(payload);
    const signature = createHmac("sha256", secret)
      .update(timestamp + "." + body)
      .digest("hex");
    const res = await fetch(settings.webhookUrl, {
      method: "POST",
      redirect: "error",
      headers: {
        "Content-Type": "application/json",
        "X-Titan-Event": jobId,
        "X-Titan-Timestamp": timestamp,
        "X-Titan-Signature": signature,
      },
      body,
      signal: AbortSignal.timeout(10000),
    });
    demand(res.ok, 502, "Webhook receiver rejected delivery");
  }
}
