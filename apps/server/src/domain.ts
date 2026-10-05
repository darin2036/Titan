import {
  type StorageAdapter,
  type Change,
  encode,
  decode,
  GitStorage,
} from "./storage.ts";
import { Index } from "./index.ts";
import {
  UnitSchema,
  SettingsSchema,
  AssertionSchema,
  FeedbackSchema,
  type Unit,
  type RecordView,
  type Assertion,
  type Principal,
  type Event,
  uid,
  now,
  hash,
  demand,
  human,
  authorize,
} from "./contracts.ts";
import { z } from "zod";
export const OWNER: Principal = { id: "owner", role: "human", scopes: ["*"] };
export const INFERENCE: Principal = {
  id: "titan-intelligence",
  role: "agent",
  scopes: ["read", "write", "infer"],
};
const withoutRevision = (unit: RecordView) => {
  const { revision, ...value } = unit;
  return value;
};
const json = (value: unknown) => JSON.stringify(value, null, 2) + "\n";
const NewUnit = UnitSchema.omit({
  id: true,
  schemaVersion: true,
  createdAt: true,
  updatedAt: true,
  lifecycle: true,
});
const EditUnit = UnitSchema.pick({
  title: true,
  body: true,
  status: true,
  validity: true,
  authority: true,
  applicability: true,
  extensions: true,
}).partial();
export class Domain {
  issues: { path: string; message: string }[] = [];
  constructor(
    public storage: StorageAdapter,
    public index: Index,
  ) {
    storage.initialize();
    this.reconcile(false);
    this.restoreJobs();
  }
  settings() {
    return SettingsSchema.parse(
      JSON.parse(this.storage.read(".titan/workspace.json")!),
    );
  }
  private eligible(units: RecordView[]) {
    const byId = new Map(units.map((u) => [u.id, u]));
    const valid = (u: RecordView, seen = new Set<string>()): boolean => {
      if (u.lifecycle !== "active" || seen.has(u.id)) return false;
      const refs = u.extensions["titan:sources"];
      if (!refs) return true;
      const parsed = z.record(z.string().uuid(), z.string()).safeParse(refs);
      if (!parsed.success) return false;
      seen.add(u.id);
      return Object.entries(parsed.data).every(([id, revision]) => {
        const source = byId.get(id);
        return (
          !!source &&
          source.revision === revision &&
          valid(source, new Set(seen))
        );
      });
    };
    return new Set(units.filter((u) => valid(u)).map((u) => u.id));
  }
  records(p: Principal, includeRemoved = false) {
    authorize(p, "read");
    if (includeRemoved) human(p);
    this.reconcile();
    const units = this.index.all();
    const eligible = this.eligible(units);
    return units.filter((u) => includeRemoved || eligible.has(u.id));
  }
  get(p: Principal, id: string, includeRemoved = false) {
    const u = this.records(p, includeRemoved).find((u) => u.id === id);
    demand(u, 404, "Record unavailable");
    return u;
  }
  assertions(p: Principal) {
    authorize(p, "read");
    const visible = new Set(
      this.records(p, p.role === "human").map((u) => u.id),
    );
    return this.objects<Assertion>("assertions").filter(
      (a) =>
        visible.has(a.source) &&
        visible.has(a.target) &&
        a.evidence.every((id) => visible.has(id)),
    );
  }
  objects<T>(dir: string): T[] {
    return this.storage
      .files(`.titan/${dir}`)
      .filter((p) => p.endsWith(".json"))
      .flatMap((path) => {
        try {
          return [JSON.parse(this.storage.read(path)!) as T];
        } catch {
          return [];
        }
      });
  }
  private path(id: string) {
    if (this.storage instanceof GitStorage) return this.storage.unitPath(id);
    return `records/${id}.md`;
  }
  private event(
    p: Principal,
    operation: string,
    units: RecordView[],
    justification: string,
    outcome = "applied",
    extra: Partial<Event> = {},
  ): Event {
    return {
      schemaVersion: 1,
      id: uid(),
      activity: uid(),
      actor: p,
      operation,
      entities: units.map((u) => u.id),
      revisions: Object.fromEntries(units.map((u) => [u.id, u.revision])),
      justification: z.string().max(600).parse(justification),
      outcome,
      at: now(),
      ...extra,
    };
  }
  private job(kind: string, payload: unknown) {
    const id = uid();
    return { id, kind, payload };
  }
  private commit(
    changes: Change[],
    event: Event,
    jobs: { id: string; kind: string; payload: unknown }[] = [],
  ) {
    this.storage.transaction(
      [
        ...changes,
        { path: `.titan/events/${event.id}.json`, content: json(event) },
        ...jobs.map((j) => ({
          path: `.titan/jobs/${j.id}.json`,
          content: json(j),
        })),
      ],
      `Titan: ${event.operation}`,
    );
    this.reconcile(false);
    for (const j of jobs) this.index.enqueue(j.id, j.kind, j.payload);
  }
  log(
    p: Principal,
    operation: string,
    units: RecordView[],
    reason: string,
    outcome: string,
    extra: Partial<Event> = {},
  ) {
    this.commit([], this.event(p, operation, units, reason, outcome, extra));
  }
  create(p: Principal, input: unknown) {
    authorize(p, "write");
    const data = NewUnit.parse(input);
    demand(
      !(data.status === "completed" && data.kind === "work"),
      422,
      "Create work before accepting completion",
    );
    const u: Unit = {
      ...data,
      schemaVersion: 1,
      id: uid(),
      lifecycle: "active",
      createdAt: now(),
      updatedAt: now(),
    };
    if (
      p.role === "agent" &&
      this.settings().autonomy === "bounded" &&
      (u.authority === "approved" || u.status === "accepted")
    )
      return this.reviewMutation(
        p,
        "create",
        u,
        [],
        "Authoritative record requires review",
      );
    return this.writeUnit(p, u, undefined, "create", "Record authored");
  }
  private reviewMutation(
    p: Principal,
    action: string,
    value: unknown,
    units: RecordView[],
    reason: string,
  ) {
    const proposal = {
      id: uid(),
      action,
      value,
      state: "proposed",
      revisions: Object.fromEntries(units.map((u) => [u.id, u.revision])),
      createdAt: now(),
      actor: p,
    };
    this.commit(
      [{ path: `.titan/reviews/${proposal.id}.json`, content: json(proposal) }],
      this.event(p, action, units, reason, "proposed"),
    );
    return { reviewId: proposal.id, state: "proposed" };
  }
  private writeUnit(
    p: Principal,
    u: Unit,
    before: RecordView | undefined,
    operation: string,
    reason: string,
  ) {
    const path = this.path(u.id);
    const revision = hash(encode(u));
    const view = { ...u, revision };
    const jobs = [
      this.job("infer", { ids: [u.id], revisions: { [u.id]: revision } }),
    ];
    if (
      u.kind === "work" &&
      u.status === "ready" &&
      before?.status !== "ready" &&
      this.settings().webhookUrl
    )
      jobs.push(
        this.job("webhook", {
          eventId: uid(),
          type: "work.ready",
          workId: u.id,
          revision,
          context: [{ id: u.id, revision }],
        }),
      );
    this.commit(
      [{ path, content: encode(u) }],
      this.event(p, operation, before ? [before] : [view], reason),
      jobs,
    );
    return view;
  }
  edit(
    p: Principal,
    id: string,
    revision: string,
    patch: unknown,
    reason = "Record revised",
    bypass = false,
  ) {
    authorize(p, "write");
    const before = this.get(p, id);
    demand(
      before.revision === revision,
      409,
      "Record changed; refresh before revising",
    );
    const data = EditUnit.parse(patch);
    const u = UnitSchema.parse({
      ...withoutRevision(before),
      ...data,
      updatedAt: now(),
    });
    if (u.kind === "work" && u.status === "completed")
      this.completionEvidence(p, id);
    const consequential =
      (["knowledge", "decision", "evidence"].includes(before.kind) &&
        (before.status === "accepted" || before.authority === "approved") &&
        Object.keys(data).some(
          (key) =>
            JSON.stringify((before as any)[key]) !==
            JSON.stringify((data as any)[key]),
        )) ||
      (u.authority === "approved" && before.authority !== "approved") ||
      (u.status === "accepted" && before.status !== "accepted") ||
      (u.status === "completed" && before.status !== "completed") ||
      (u.validity === "superseded" && before.validity !== "superseded");
    if (
      !bypass &&
      p.role === "agent" &&
      this.settings().autonomy === "bounded" &&
      consequential
    )
      return this.reviewMutation(
        p,
        "edit",
        { id, revision, patch: data },
        [before],
        reason,
      );
    const result = this.writeUnit(p, u, before, "edit", reason);
    if (
      p.role === "human" &&
      u.kind === "work" &&
      u.status === "completed" &&
      before.status !== "completed"
    )
      this.feedback(p, {
        type: "verified_outcome",
        label: "completed",
        entities: [id],
        justification: "Owner accepted completion with supported evidence",
      });
    if (p.role === "human")
      this.feedback(p, {
        type: "human_correction",
        label: "revised",
        entities: [id],
        justification: reason,
      });
    return result;
  }
  private completionEvidence(p: Principal, id: string) {
    const has = this.assertions(p).some((a) => {
      if (a.state !== "accepted" || a.type !== "supports" || a.target !== id)
        return false;
      const evidence = this.get(p, a.source);
      if (
        evidence.kind !== "evidence" ||
        evidence.validity !== "supported" ||
        evidence.status !== "accepted"
      )
        return false;
      if (evidence.revision === a.revisions[evidence.id]) return true;
      const source = this.storage
        .history(evidence.id)
        .find((u) => u.revision === a.revisions[evidence.id]);
      return (
        !!source &&
        source.body === evidence.body &&
        JSON.stringify(source.applicability) ===
          JSON.stringify(evidence.applicability)
      );
    });
    demand(has, 422, "Accepted evidence is required to complete work");
  }
  remove(p: Principal, id: string, revision: string, reason: string) {
    authorize(p, "write");
    const before = this.get(p, id);
    demand(before.revision === revision, 409, "Record changed");
    const u = UnitSchema.parse({
      ...withoutRevision(before),
      lifecycle: "removed",
      updatedAt: now(),
    });
    const affected = this.objects<Assertion>("assertions").filter(
      (a) => a.source === id || a.target === id || a.evidence.includes(id),
    );
    const event = this.event(p, "remove", [before], reason);
    const changes: Change[] = [
      { path: this.path(id), content: encode(u) },
      ...affected.map((a) => ({
        path: `.titan/assertions/${a.id}.json`,
        content: json({ ...a, state: "superseded" }),
      })),
    ];
    this.commit(changes, event, [
      this.job("evaluate", { reason: "removal", ids: [id] }),
    ]);
    return { ...u, revision: hash(encode(u)) };
  }
  restore(p: Principal, id: string, revision: string) {
    human(p);
    const before = this.get(p, id, true);
    demand(before.revision === revision, 409, "Record changed");
    demand(before.lifecycle === "removed", 422, "Record is not removed");
    const u = UnitSchema.parse({
      ...withoutRevision(before),
      lifecycle: "active",
      validity: "unverified",
      updatedAt: now(),
    });
    return this.writeUnit(
      p,
      u,
      before,
      "restore",
      "Owner restored record; interpretations require reevaluation",
    );
  }
  history(p: Principal, id: string) {
    this.get(p, id, p.role === "human");
    return this.storage
      .history(id)
      .filter((u) => p.role === "human" || u.lifecycle === "active");
  }
  relate(
    p: Principal,
    input: unknown,
    meta: { model?: string; policyVersion?: string } = {},
  ) {
    authorize(p, "write");
    const args = z
      .object({
        source: z.string().uuid(),
        target: z.string().uuid(),
        type: z.string(),
        justification: z.string().max(600),
        evidence: z.array(z.string().uuid()).default([]),
        revisions: z.record(z.string(), z.string()),
      })
      .strict()
      .parse(input);
    demand(
      args.source !== args.target,
      422,
      "Self relationships are not supported",
    );
    demand(
      this.settings().relationshipTypes.some((t) => t.key === args.type),
      422,
      "Unknown relationship type",
    );
    const units = [
      ...new Set([args.source, args.target, ...args.evidence]),
    ].map((id) => this.get(p, id));
    for (const u of units)
      demand(
        args.revisions[u.id] === u.revision,
        409,
        "Relationship source changed",
      );
    const prior = this.assertions(p).find(
      (a) =>
        a.source === args.source &&
        a.target === args.target &&
        a.type === args.type &&
        ["accepted", "proposed"].includes(a.state),
    );
    if (prior) return prior;
    if (args.type === "contains" || args.type === "blocks") {
      const links = this.assertions(p).filter(
        (a) => a.state === "accepted" && a.type === args.type,
      );
      const reachable = (node: string, seen = new Set<string>()): boolean => {
        if (node === args.source) return true;
        if (seen.has(node)) return false;
        seen.add(node);
        return links
          .filter((a) => a.source === node)
          .some((a) => reachable(a.target, seen));
      };
      demand(!reachable(args.target), 422, "Relationship would create a cycle");
    }
    const consequential = ["supersedes", "contradicts"].includes(args.type);
    const state =
      p.role === "agent" &&
      this.settings().autonomy === "bounded" &&
      consequential
        ? "proposed"
        : "accepted";
    const event = this.event(
      p,
      "relationship",
      units,
      args.justification,
      state,
      meta,
    );
    const assertion = AssertionSchema.parse({
      ...args,
      schemaVersion: 1,
      id: uid(),
      state,
      activity: event.activity,
      createdAt: now(),
    });
    const changes: Change[] = [
      {
        path: `.titan/assertions/${assertion.id}.json`,
        content: json(assertion),
      },
    ];
    if (state === "accepted")
      changes.push(...this.relationshipEffects(assertion, units));
    this.commit(changes, event);
    return assertion;
  }
  private relationshipEffects(a: Assertion, units: RecordView[]) {
    const changes: Change[] = [];
    if (a.type === "supersedes" || a.type === "contradicts") {
      const target = units.find((u) => u.id === a.target)!;
      const { revision, ...rest } = target;
      const updated = {
        ...rest,
        validity:
          a.type === "supersedes"
            ? ("superseded" as const)
            : ("disputed" as const),
        updatedAt: now(),
      };
      changes.push({ path: this.path(target.id), content: encode(updated) });
    }
    return changes;
  }
  reviews(p: Principal) {
    human(p);
    return {
      relationships: this.assertions(p).filter((a) => a.state === "proposed"),
      mutations: this.objects<any>("reviews").filter(
        (r) => r.state === "proposed",
      ),
    };
  }
  review(p: Principal, id: string, accept: boolean) {
    human(p);
    const a = this.objects<Assertion>("assertions").find((a) => a.id === id);
    if (a) {
      demand(a.state === "proposed", 409, "Already reviewed");
      const units = [...new Set([a.source, a.target, ...a.evidence])].map(
        (id) => this.get(p, id),
      );
      for (const u of units)
        demand(
          a.revisions[u.id] === u.revision,
          409,
          "Proposal is stale; reevaluate first",
        );
      const changes = [
        {
          path: `.titan/assertions/${a.id}.json`,
          content: json({ ...a, state: accept ? "accepted" : "rejected" }),
        },
        ...(accept ? this.relationshipEffects(a, units) : []),
      ];
      this.commit(
        changes,
        this.event(
          p,
          "review",
          units,
          "Owner reviewed relationship",
          accept ? "accepted" : "rejected",
        ),
      );
      this.feedback(p, {
        type: accept ? "accepted_proposal" : "rejected_proposal",
        label: a.type,
        entities: units.map((u) => u.id),
        justification: "Owner reviewed relationship",
      });
      return;
    }
    const r = this.objects<any>("reviews").find((r) => r.id === id);
    demand(r && r.state === "proposed", 404, "Review unavailable");
    for (const [id, revision] of Object.entries(r.revisions))
      demand(this.get(p, id).revision === revision, 409, "Proposal is stale");
    if (accept) {
      if (r.action === "create")
        this.writeUnit(
          p,
          UnitSchema.parse(r.value),
          undefined,
          "create",
          "Owner accepted proposal",
        );
      else
        this.edit(
          p,
          r.value.id,
          r.value.revision,
          r.value.patch,
          "Owner accepted proposal",
          true,
        );
    }
    this.commit(
      [
        {
          path: `.titan/reviews/${id}.json`,
          content: json({ ...r, state: accept ? "accepted" : "rejected" }),
        },
      ],
      this.event(
        p,
        "review",
        [],
        "Owner reviewed mutation",
        accept ? "accepted" : "rejected",
      ),
    );
  }
  feedback(p: Principal, input: unknown) {
    authorize(p, "write");
    const f = FeedbackSchema.parse(input);
    if (
      [
        "accepted_proposal",
        "rejected_proposal",
        "human_correction",
        "verified_outcome",
      ].includes(f.type)
    )
      human(p);
    const units = f.entities.map((id) => this.get(p, id));
    const value = {
      ...f,
      schemaVersion: 1,
      id: uid(),
      deploymentId: this.settings().deploymentId,
      revisions: Object.fromEntries(units.map((u) => [u.id, u.revision])),
      actor: p,
      at: now(),
    };
    this.commit(
      [{ path: `.titan/feedback/${value.id}.json`, content: json(value) }],
      this.event(p, "feedback", units, f.justification),
    );
    return value;
  }
  outcome(p: Principal, input: unknown) {
    authorize(p, "write");
    const b = z
      .object({
        eventId: z.string().uuid(),
        workId: z.string().uuid(),
        revision: z.string(),
        title: z.string().min(1).max(200),
        body: z.string().max(100000),
        verified: z.boolean().default(false),
      })
      .strict()
      .parse(input);
    const key = hash(this.settings().deploymentId + p.id + b.eventId);
    const marker = this.storage.read(`.titan/outcomes/${key}.json`);
    if (marker) return this.get(p, JSON.parse(marker).evidenceId);
    const work = this.get(p, b.workId);
    demand(
      work.kind === "work" && work.revision === b.revision,
      409,
      "Work revision changed",
    );
    const evidence = UnitSchema.parse({
      schemaVersion: 1,
      id: uid(),
      kind: "evidence",
      title: b.title,
      body: b.body,
      lifecycle: "active",
      status: "draft",
      validity: "unverified",
      authority: "observed",
      applicability: work.applicability,
      createdAt: now(),
      updatedAt: now(),
      extensions: { "titan:reportedVerified": b.verified },
    });
    const revision = hash(encode(evidence));
    const view = { ...evidence, revision };
    const reason =
      "External workflow reported an outcome; verification remains separate";
    const event = this.event(p, "record_outcome", [work, view], reason);
    const assertion = AssertionSchema.parse({
      schemaVersion: 1,
      id: uid(),
      source: evidence.id,
      target: work.id,
      type: "supports",
      state: "accepted",
      justification: reason,
      evidence: [evidence.id],
      revisions: { [evidence.id]: revision, [work.id]: work.revision },
      activity: event.activity,
      createdAt: now(),
    });
    this.commit(
      [
        { path: this.path(evidence.id), content: encode(evidence) },
        {
          path: `.titan/assertions/${assertion.id}.json`,
          content: json(assertion),
        },
        {
          path: `.titan/outcomes/${key}.json`,
          content: json({
            schemaVersion: 1,
            eventId: b.eventId,
            evidenceId: evidence.id,
            actor: p.id,
          }),
        },
      ],
      event,
      [
        this.job("infer", {
          ids: [evidence.id],
          revisions: { [evidence.id]: revision },
        }),
      ],
    );
    return view;
  }
  audit(p: Principal) {
    authorize(p, "read");
    if (p.role === "human")
      return this.objects<Event>("events").sort((a, b) =>
        b.at.localeCompare(a.at),
      );
    const visible = new Set(this.records(p).map((u) => u.id));
    return this.objects<Event>("events")
      .filter((e) => e.entities.every((id) => visible.has(id)))
      .map(({ justification, ...e }) => ({ ...e, justification: "" }));
  }
  updateSettings(p: Principal, patch: unknown) {
    human(p);
    const input = z
      .object({
        autonomy: SettingsSchema.shape.autonomy.optional(),
        provider: SettingsSchema.shape.provider.optional(),
        model: z.string().min(1).max(120).optional(),
        credentialRef: SettingsSchema.shape.credentialRef.optional(),
        embeddingModel: z.string().max(120).optional(),
        webhookUrl: z.string().max(2000).optional(),
        relationshipTypes: SettingsSchema.shape.relationshipTypes.optional(),
      })
      .strict()
      .parse(patch);
    if (input.webhookUrl) {
      const url = new URL(input.webhookUrl);
      demand(
        url.protocol === "https:" ||
          (url.protocol === "http:" &&
            ["localhost", "127.0.0.1"].includes(url.hostname)),
        422,
        "Webhook requires HTTPS (localhost allowed for testing)",
      );
    }
    const settings = SettingsSchema.parse({ ...this.settings(), ...input });
    demand(
      settings.provider === "fixture" || settings.model !== "fixture-v1",
      422,
      "Select a model explicitly",
    );
    demand(
      settings.provider !== "openai" ||
        settings.credentialRef === "OPENAI_API_KEY",
      422,
      "OpenAI credential reference required",
    );
    demand(
      settings.provider !== "anthropic" ||
        settings.credentialRef === "ANTHROPIC_API_KEY",
      422,
      "Anthropic credential reference required",
    );
    this.commit(
      [{ path: ".titan/workspace.json", content: json(settings) }],
      this.event(p, "settings", [], "Owner updated deployment policy"),
    );
    return settings;
  }
  context(
    p: Principal,
    query: string,
    scope: string[] = [],
    additionalIds: string[] = [],
  ) {
    authorize(p, "read");
    this.reconcile();
    const candidates = this.index.search(query);
    const links = this.assertions(p).filter((a) => a.state === "accepted");
    const ids = new Set([
      ...candidates.slice(0, 15).map((u) => u.id),
      ...additionalIds,
    ]);
    for (const a of links)
      if (ids.has(a.source) || ids.has(a.target)) {
        ids.add(a.source);
        ids.add(a.target);
      }
    const result = this.records(p)
      .filter(
        (u) =>
          ids.has(u.id) &&
          (!u.applicability.length ||
            !scope.length ||
            u.applicability.some((s) => scope.includes(s))),
      )
      .map((u) => ({
        ...u,
        usableAsBasis: u.validity !== "superseded" && u.validity !== "disputed",
        warnings: [
          ...(u.validity === "superseded"
            ? ["Superseded: historical context only"]
            : []),
          ...(u.validity === "disputed"
            ? ["Disputed: requires resolution"]
            : []),
          ...(u.applicability.length && !scope.length
            ? ["Scoped guidance: confirm applicability before use"]
            : []),
          ...(u.authority === "hypothesis"
            ? ["Hypothesis: not an authoritative decision"]
            : []),
        ],
        relationships: links.filter(
          (a) => a.source === u.id || a.target === u.id,
        ),
      }));
    if (result.length)
      this.log(
        p,
        "context_snapshot",
        result,
        "Retrieved context with exact source revisions",
        "assembled",
      );
    return result;
  }
  dataset(p: Principal) {
    human(p);
    const active = new Set(this.records(p).map((u) => u.id));
    const labels = this.objects<any>("feedback").filter(
      (f) =>
        f.deploymentId === this.settings().deploymentId &&
        f.entities.every((id: string) => active.has(id)),
    );
    const manifest = {
      schemaVersion: 1,
      id: uid(),
      deploymentId: this.settings().deploymentId,
      createdAt: now(),
      policyVersion: "inference-v1",
      labels: labels.map((f) => ({
        id: f.id,
        type: f.type,
        label: f.label,
        entities: f.entities,
        revisions: f.revisions,
        actor: f.actor,
        at: f.at,
      })),
      sourceRevisions: Object.fromEntries(
        this.records(p).map((u) => [u.id, u.revision]),
      ),
    };
    this.commit(
      [
        {
          path: `.titan/datasets/${manifest.id}.json`,
          content: json(manifest),
        },
      ],
      this.event(
        p,
        "dataset",
        [],
        "Owner captured deployment-local label manifest",
      ),
    );
    return manifest;
  }
  activate(p: Principal, modelId: string) {
    human(p);
    const artifact = this.objects<any>("models").find((m) => m.id === modelId);
    demand(
      artifact &&
        artifact.evaluation?.passed &&
        artifact.deploymentId === this.settings().deploymentId,
      422,
      "Evaluated deployment-local candidate required",
    );
    demand(
      artifact.checksum ===
        hash(
          JSON.stringify(
            Object.fromEntries(
              Object.entries(artifact.weights as Record<string, number>).sort(
                ([a], [b]) => a.localeCompare(b),
              ),
            ),
          ),
        ),
      422,
      "Ranking artifact checksum mismatch",
    );
    const active = new Set(this.records(p).map((u) => u.id));
    demand(
      artifact.sourceIds.every((id: string) => active.has(id)),
      422,
      "Candidate includes removed sources",
    );
    const settings = this.settings();
    this.commit(
      [
        {
          path: ".titan/workspace.json",
          content: json({
            ...settings,
            previousModel: settings.activeModel,
            activeModel: modelId,
          }),
        },
      ],
      this.event(p, "activate_model", [], "Owner activated evaluated model"),
    );
  }
  rollback(p: Principal) {
    human(p);
    const settings = this.settings();
    demand(settings.previousModel, 422, "No previous model");
    this.commit(
      [
        {
          path: ".titan/workspace.json",
          content: json({
            ...settings,
            activeModel: settings.previousModel,
            previousModel: settings.activeModel,
          }),
        },
      ],
      this.event(
        p,
        "rollback_model",
        [],
        "Owner rolled back intelligence version",
      ),
    );
  }
  reconcile(recordEvents = true) {
    const units: RecordView[] = [];
    this.issues = [];
    const seen = new Set<string>();
    const changes: Change[] = [];
    const events: Event[] = [];
    for (const path of this.storage
      .files("records")
      .filter((f) => f.endsWith(".md"))) {
      try {
        const u = decode(this.storage.read(path)!);
        demand(!seen.has(u.id), 422, "Duplicate identity");
        seen.add(u.id);
        units.push(u);
        const previous = this.index.db
          .prepare("SELECT revision FROM observed WHERE path=?")
          .get(path) as { revision: string } | undefined;
        if (recordEvents && previous && previous.revision !== u.revision)
          events.push(
            this.event(
              { id: "external-editor", role: "agent", scopes: ["write"] },
              "external_edit",
              [u],
              "External repository edit observed",
            ),
          );
        this.index.db
          .prepare("INSERT OR REPLACE INTO observed VALUES(?,?)")
          .run(path, u.revision);
      } catch (e) {
        this.issues.push({
          path,
          message: e instanceof Error ? e.message : "Malformed record",
        });
      }
    }
    this.index.replace(units, this.eligible(units));
    if (events.length) {
      for (const e of events) {
        changes.push({ path: `.titan/events/${e.id}.json`, content: json(e) });
        const j = this.job("infer", {
          ids: e.entities,
          revisions: e.revisions,
        });
        changes.push({ path: `.titan/jobs/${j.id}.json`, content: json(j) });
      }
      this.storage.transaction(changes, "Titan: reconcile external edits");
      this.restoreJobs();
    }
  }
  restoreJobs() {
    for (const j of this.objects<any>("jobs"))
      this.index.enqueue(j.id, j.kind, j.payload);
  }
}
