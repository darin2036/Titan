import { ConnectedStorage } from "./connected-storage.ts";
import { assessReliability } from "../../shared/reliability.ts";
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
  ComposerContentSchema,
  type ComposerDraft,
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
import { PlaceContentSchema, PlaceSchema } from "./places.ts";
import type { Place, PlaceView, PlaceSuggestion } from "../../shared/places.ts";
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
// Creation defaults must not reset metadata omitted from a revision patch.
const EditUnit = z
  .object({
    title: UnitSchema.shape.title,
    body: UnitSchema.shape.body,
    status: UnitSchema.shape.status.removeDefault(),
    validity: UnitSchema.shape.validity.removeDefault(),
    authority: UnitSchema.shape.authority.removeDefault(),
    applicability: UnitSchema.shape.applicability.removeDefault(),
    extensions: UnitSchema.shape.extensions.removeDefault(),
  })
  .partial()
  .strict();
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
  places(p: Principal): PlaceView[] {
    human(p);
    authorize(p, "read");
    const units = this.records(p);
    const visible = new Map(units.map((u) => [u.id, u]));
    const links = this.assertions(p).filter(
      (a) =>
        a.state === "accepted" &&
        [a.source, a.target, ...a.evidence].every(
          (id) =>
            visible.has(id) && visible.get(id)!.revision === a.revisions[id],
        ),
    );
    return this.storage
      .files(".titan/places")
      .filter((path) => path.endsWith(".json"))
      .map((path) => {
        const raw = this.storage.read(path)!;
        const place: Place = PlaceSchema.parse(JSON.parse(raw));
        const suggestions = new Map<string, PlaceSuggestion>();
        if (place.organization === "assisted") {
          for (const link of links) {
            const sourceMember = place.memberIds.includes(link.source);
            const targetMember = place.memberIds.includes(link.target);
            if (sourceMember === targetMember) continue;
            const recordId = sourceMember ? link.target : link.source;
            const entry = suggestions.get(recordId) ?? {
              recordId,
              connections: [],
            };
            entry.connections.push({
              id: link.id,
              anchorId: sourceMember ? link.source : link.target,
              type: link.type,
              justification: link.justification,
              evidence: link.evidence,
            });
            suggestions.set(recordId, entry);
          }
        }
        return {
          ...place,
          revision: hash(raw),
          suggestions: [...suggestions.values()],
        };
      })
      .sort(
        (a, b) =>
          a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
      );
  }
  savePlace(
    p: Principal,
    input: unknown,
    id?: string,
    revision?: string,
  ): PlaceView {
    human(p);
    authorize(p, "write");
    if (id) z.string().uuid().parse(id);
    const content = PlaceContentSchema.parse(input);
    const before = id
      ? this.places(p).find((place) => place.id === id)
      : undefined;
    if (id) demand(before, 404, "This place is unavailable");
    if (before)
      demand(
        before.revision === revision,
        409,
        "This place changed in another window. Reopen it before saving.",
      );
    // Existing unavailable records may be retained so restore keeps their membership.
    const added = content.memberIds.filter(
      (id) => !before?.memberIds.includes(id),
    );
    const units = added.map((id) => this.get(p, id));
    const place: Place = {
      ...content,
      schemaVersion: 1,
      id: id ?? uid(),
      createdAt: before?.createdAt ?? now(),
      updatedAt: now(),
    };
    this.commit(
      [{ path: `.titan/places/${place.id}.json`, content: json(place) }],
      this.event(
        p,
        before ? "organize_place" : "create_place",
        units,
        "Owner organized a workspace place",
        "applied",
        { entities: [place.id, ...units.map((u) => u.id)] },
      ),
    );
    return this.places(p).find((p) => p.id === place.id)!;
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
    const hidden =
      this.storage instanceof ConnectedStorage
        ? this.storage.hiddenIds()
        : new Set<string>();
    const accessible = (u: RecordView, seen = new Set<string>()): boolean => {
      if (hidden.has(u.id) || seen.has(u.id)) return false;
      const refs = u.extensions["titan:sources"];
      if (!refs || typeof refs !== "object" || Array.isArray(refs)) return true;
      return Object.keys(refs).every(
        (id) =>
          !hidden.has(id) &&
          (!units.find((r) => r.id === id) ||
            accessible(
              units.find((r) => r.id === id)!,
              new Set([...seen, u.id]),
            )),
      );
    };
    return units.filter(
      (u) => accessible(u) && (includeRemoved || eligible.has(u.id)),
    );
  }
  reliability(p: Principal, id: string, scope: string[] = []) {
    const units = this.records(p);
    const record = units.find((u) => u.id === id);
    demand(record, 404, "Record unavailable");
    return assessReliability(record, units, this.assertions(p), scope);
  }
  observeConnected(input: unknown, before?: RecordView) {
    const unit = UnitSchema.parse(input);
    demand(
      this.storage instanceof ConnectedStorage,
      422,
      "Connected storage is unavailable",
    );
    return this.writeUnit(
      { id: "confluence", role: "agent", scopes: ["read", "write"] },
      unit,
      before,
      "confluence_observed",
      "Confluence source revision observed",
    );
  }
  proposeConnectedLinks(pairs: { source: string; target: string }[]) {
    const actor: Principal = {
      id: "confluence",
      role: "agent",
      scopes: ["read", "write"],
    };
    const units = this.records(actor);
    const existing = this.assertions(actor);
    const changes: Change[] = [];
    const touched = new Map<string, RecordView>();
    const event = this.event(
      actor,
      "confluence_links",
      [],
      "Confluence links proposed as connections; they do not establish support",
      "proposed",
    );
    for (const pair of pairs) {
      if (pair.source === pair.target) continue;
      const source = units.find((u) => u.id === pair.source);
      const target = units.find((u) => u.id === pair.target);
      if (!source || !target) continue;
      const prior = existing.find(
        (a) =>
          a.source === source.id &&
          a.target === target.id &&
          a.type === "relates" &&
          ["accepted", "proposed"].includes(a.state),
      );
      if (
        prior &&
        prior.revisions[source.id] === source.revision &&
        prior.revisions[target.id] === target.revision
      )
        continue;
      if (prior)
        changes.push({
          path: `.titan/assertions/${prior.id}.json`,
          content: json({ ...prior, state: "superseded" }),
        });
      const assertion = AssertionSchema.parse({
        schemaVersion: 1,
        id: uid(),
        ...pair,
        type: "relates",
        state: "proposed",
        justification: "The Confluence page links to this connected page.",
        evidence: [],
        revisions: {
          [source.id]: source.revision,
          [target.id]: target.revision,
        },
        activity: event.activity,
        createdAt: now(),
      });
      changes.push({
        path: `.titan/assertions/${assertion.id}.json`,
        content: json(assertion),
      });
      touched.set(source.id, source);
      touched.set(target.id, target);
      existing.push(assertion);
    }
    if (changes.length)
      this.commit(changes, {
        ...event,
        entities: [...touched.keys()],
        revisions: Object.fromEntries(
          [...touched].map(([id, u]) => [id, u.revision]),
        ),
      });
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
      !data.extensions["titan:confluence"],
      422,
      "Confluence provenance is managed by the connection",
    );
    if (data.extensions["titan:sources"]) {
      const sources = z
        .record(z.string().uuid(), z.string().min(1))
        .parse(data.extensions["titan:sources"]);
      for (const [id, revision] of Object.entries(sources))
        demand(
          this.get(p, id).revision === revision,
          409,
          "A source changed. Prepare a fresh draft before publishing.",
        );
    }
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
  composerDrafts(p: Principal): ComposerDraft[] {
    human(p);
    authorize(p, "read");
    return (
      this.index.db
        .prepare(
          "SELECT data FROM composer_drafts WHERE published_id IS NULL ORDER BY rowid DESC",
        )
        .all() as { data: string }[]
    ).map((row) => JSON.parse(row.data));
  }
  private composerRow(id: string) {
    z.string().uuid().parse(id);
    return this.index.db
      .prepare("SELECT data,published_id FROM composer_drafts WHERE id=?")
      .get(id) as { data: string; published_id: string | null } | undefined;
  }
  saveComposerDraft(p: Principal, id: string, version: number, input: unknown) {
    human(p);
    authorize(p, "write");
    z.number().int().nonnegative().parse(version);
    const content = ComposerContentSchema.parse(input);
    const row = this.composerRow(id);
    const before = row ? (JSON.parse(row.data) as ComposerDraft) : null;
    demand(
      !row?.published_id,
      409,
      "This draft is already published. Edit the published page instead.",
    );
    demand(
      (before?.version ?? 0) === version,
      409,
      "This draft changed in another window. Reopen it before saving.",
    );
    if (before)
      demand(
        JSON.stringify(before.source) === JSON.stringify(content.source),
        422,
        "A draft’s source cannot change",
      );
    if (content.source) {
      const source = this.get(p, content.source.id, true);
      demand(
        source.kind === content.kind,
        422,
        "A page’s record type cannot change",
      );
      // Saving never overwrites the source. Preserve even a stale first draft;
      // its source revision is checked when the owner publishes it.
    }
    const draft: ComposerDraft = {
      ...content,
      id,
      version: version + 1,
      updatedAt: now(),
    };
    this.index.db
      .prepare(
        "INSERT INTO composer_drafts(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
      )
      .run(id, JSON.stringify(draft));
    return draft;
  }
  discardComposerDraft(p: Principal, id: string, version: number) {
    human(p);
    authorize(p, "write");
    const row = this.composerRow(id);
    demand(row, 404, "Draft unavailable");
    demand(
      !row.published_id && JSON.parse(row.data).version === version,
      409,
      "This draft changed. Reopen it before discarding.",
    );
    this.index.db.prepare("DELETE FROM composer_drafts WHERE id=?").run(id);
    return { ok: true };
  }
  rebaseComposerDraft(
    p: Principal,
    id: string,
    version: number,
    revision: string,
  ) {
    human(p);
    authorize(p, "write");
    const row = this.composerRow(id);
    demand(row, 404, "Draft unavailable");
    const draft = JSON.parse(row.data) as ComposerDraft;
    demand(
      !row.published_id && draft.version === version,
      409,
      "This draft changed. Reopen it before continuing.",
    );
    demand(draft.source, 422, "This draft does not revise a published page");
    const source = this.get(p, draft.source.id);
    demand(
      source.revision === revision,
      409,
      "The published page changed again. Compare the latest version before continuing.",
    );
    const next = {
      ...draft,
      source: { id: source.id, revision },
      version: version + 1,
      updatedAt: now(),
    };
    this.index.db
      .prepare("UPDATE composer_drafts SET data=? WHERE id=?")
      .run(JSON.stringify(next), id);
    return next;
  }
  publishComposerDraft(p: Principal, id: string, version: number) {
    human(p);
    authorize(p, "write");
    const row = this.composerRow(id);
    demand(row, 404, "Draft unavailable");
    const draft = JSON.parse(row.data) as ComposerDraft;
    demand(
      draft.version === version,
      409,
      "This draft changed. Save and review the latest draft before publishing.",
    );
    if (row.published_id) return this.get(p, row.published_id);
    demand(
      draft.title.trim() && draft.body.trim(),
      422,
      "Add a title and some content before publishing.",
    );
    // The durable marker recovers publication if the process stops between the
    // Git commit and the local draft receipt. New pages use the draft's stable ID.
    const targetId = draft.source?.id ?? draft.id;
    const before = this.records(p).find((u) => u.id === targetId);
    const marker = { draftId: draft.id, version: draft.version };
    let result: RecordView;
    if (
      before &&
      JSON.stringify(before.extensions["titan:composer"]) ===
        JSON.stringify(marker)
    ) {
      result = before;
    } else if (draft.source) {
      demand(
        before,
        404,
        "This page is unavailable. Your draft has been kept.",
      );
      demand(
        before.revision === draft.source.revision,
        409,
        "This page changed since you started editing. Your draft has been kept. Compare the latest page before publishing.",
      );
      result = this.edit(
        p,
        targetId,
        draft.source.revision,
        {
          title: draft.title,
          body: draft.body,
          applicability: draft.applicability,
          extensions: { ...before.extensions, "titan:composer": marker },
        },
        "Owner published a directly composed page",
      ) as RecordView;
    } else {
      demand(!before, 409, "A page already uses this draft’s identity");
      const unit = UnitSchema.parse({
        id: draft.id,
        schemaVersion: 1,
        kind: draft.kind,
        title: draft.title,
        body: draft.body,
        applicability: draft.applicability,
        createdAt: now(),
        updatedAt: now(),
        extensions: { "titan:composer": marker },
      });
      result = this.writeUnit(
        p,
        unit,
        undefined,
        "create",
        "Owner published a directly composed page",
      );
    }
    this.index.db
      .prepare("UPDATE composer_drafts SET published_id=? WHERE id=?")
      .run(result.id, id);
    return result;
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
      this.event(p, operation, before ? [before] : [view], reason, "applied", {
        resultingRevisions: { [u.id]: revision },
      }),
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
    const source = before.extensions["titan:confluence"] as any;
    demand(
      !data.extensions ||
        JSON.stringify(data.extensions["titan:confluence"]) ===
          JSON.stringify(source),
      422,
      "Confluence provenance is managed by the connection",
    );
    demand(
      source?.owner !== "confluence" ||
        (data.title === undefined && data.body === undefined),
      422,
      "Save connected page content through a Confluence draft",
    );
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
      mutations: this.objects<any>("reviews").filter((r) => {
        const visible = new Set(this.records(p, true).map((u) => u.id));
        const sources = r.value?.extensions?.["titan:sources"] ?? {};
        return (
          r.state === "proposed" &&
          [...Object.keys(r.revisions ?? {}), ...Object.keys(sources)].every(
            (id) => visible.has(id),
          )
        );
      }),
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
    if (p.role === "human") {
      const visible = new Set(this.records(p, true).map((u) => u.id));
      return this.objects<Event>("events")
        .filter((e) => e.entities.every((id) => visible.has(id)))
        .sort((a, b) => b.at.localeCompare(a.at));
    }
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
        providerBaseUrl: SettingsSchema.shape.providerBaseUrl.optional(),
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
    demand(
      settings.provider !== "custom" ||
        (settings.credentialRef === "CUSTOM_API_KEY" &&
          !!settings.providerBaseUrl),
      422,
      "Add a custom API base URL and credential reference",
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
    const assessmentRecords = this.records(p);
    const assessmentLinks = this.assertions(p);
    const result = assessmentRecords
      .filter(
        (u) =>
          ids.has(u.id) &&
          (!u.applicability.length ||
            !scope.length ||
            u.applicability.some((s) => scope.includes(s))),
      )
      .map((u) => ({
        ...u,
        reliability: assessReliability(
          u,
          assessmentRecords,
          assessmentLinks,
          scope,
        ),
        usableAsBasis:
          u.validity !== "superseded" &&
          u.validity !== "disputed" &&
          !(u.extensions["titan:confluence"] as any)?.issues?.length,
        warnings: [
          ...((u.extensions["titan:confluence"] as any)?.issues?.length
            ? [
                "Confluence content is partially represented: review the original",
              ]
            : []),
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
