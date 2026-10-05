import test from "node:test";
import assert from "node:assert/strict";
import {
  assessReliability,
  type ReliabilityRecord,
  type ReliabilityRelationship,
} from "../apps/shared/reliability.ts";
import { createApp } from "../apps/server/src/api.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const page: ReliabilityRecord = {
  id: "page",
  title: "Guidance",
  revision: "page-v1",
  lifecycle: "active",
  validity: "unverified",
  authority: "hypothesis",
  applicability: [],
};
const evidence: ReliabilityRecord = {
  ...page,
  id: "evidence",
  title: "Measured outcome",
  revision: "evidence-v1",
  validity: "supported",
  authority: "observed",
};
const support: ReliabilityRelationship = {
  id: "support",
  source: evidence.id,
  target: page.id,
  type: "supports",
  state: "accepted",
  justification: "Measured outcome supports guidance",
  evidence: [],
  revisions: { page: page.revision, evidence: evidence.revision },
};
const assess = (
  p = page,
  rows = [p, evidence],
  links = [support],
  scope: string[] = [],
) => assessReliability(p, rows, links, scope);
test("support requires accepted, current, supported evidence rather than recency or authority alone", () => {
  assert.equal(assess().state, "supported");
  assert.equal(
    assess(page, [page, evidence], [{ ...support, state: "proposed" }]).state,
    "not_assessed",
  );
  assert.equal(
    assess(page, [
      page,
      { ...evidence, validity: "unverified", authority: "approved" },
    ]).state,
    "needs_review",
  );
  assert.equal(
    assess(page, [page, { ...evidence, authority: "hypothesis" }]).state,
    "needs_review",
  );
  assert.equal(
    assess(
      page,
      [page, evidence],
      [{ ...support, source: page.id, target: evidence.id }],
    ).state,
    "not_assessed",
  );
  assert.equal(
    assess({ ...page, validity: "supported" }, [page], []).state,
    "needs_review",
  );
});
test("revision drift and unavailable evidence invalidate the earlier basis without crashing or exposing removed titles", () => {
  assert.equal(assess({ ...page, revision: "page-v2" }).state, "needs_review");
  assert.equal(
    assess(page, [page, { ...evidence, revision: "evidence-v2" }]).state,
    "needs_review",
  );
  const missing = assess(page, [page]);
  assert.equal(missing.state, "needs_review");
  assert.equal(missing.basis[0].records[0].title, "Unavailable record");
  const removed = assess(page, [page, { ...evidence, lifecycle: "removed" }]);
  assert.equal(removed.state, "needs_review");
  assert.equal(removed.basis[0].records[0].available, false);
  assert.equal(
    assess(page, [page, evidence], [{ ...support, revisions: {} }]).state,
    "needs_review",
  );
});
test("context must match both the claim and scoped evidence", () => {
  const scoped = { ...page, applicability: ["production"] };
  assert.equal(assess(scoped).state, "needs_review");
  assert.equal(
    assess(scoped, [scoped, evidence], [support], ["development"]).state,
    "needs_review",
  );
  assert.equal(
    assess(scoped, [scoped, evidence], [support], ["production"]).label,
    "Supported for this context",
  );
  assert.equal(
    assess(page, [page, { ...evidence, applicability: ["production"] }]).state,
    "needs_review",
  );
});
test("conflicts and replacements take precedence and proposed conflicts do not claim accepted validity", () => {
  assert.equal(assess({ ...page, validity: "disputed" }).state, "disputed");
  assert.equal(assess({ ...page, validity: "superseded" }).state, "superseded");
  assert.equal(
    assess(
      page,
      [page, evidence],
      [support, { ...support, id: "conflict", type: "contradicts" }],
    ).state,
    "disputed",
  );
  assert.equal(
    assess(page, [page, evidence], [{ ...support, type: "supersedes" }]).state,
    "superseded",
  );
  assert.equal(
    assess(
      page,
      [page, evidence],
      [support, { ...support, type: "contradicts", state: "proposed" }],
    ).state,
    "needs_review",
  );
  assert.equal(
    assess(page, [page, evidence], [{ ...support, state: "rejected" }]).state,
    "not_assessed",
  );
});
test("derived evidence requires available exact source revisions, including transitive dependencies", () => {
  const root = { ...evidence, id: "root", revision: "root-v2" };
  const derived = {
    ...evidence,
    extensions: { "titan:sources": { root: "root-v1" } },
  };
  assert.equal(assess(page, [page, derived, root]).state, "needs_review");
  assert.equal(
    assess(page, [
      page,
      { ...derived, extensions: { "titan:sources": { root: root.revision } } },
      root,
    ]).state,
    "supported",
  );
  assert.equal(
    assess(page, [
      page,
      {
        ...evidence,
        extensions: { "titan:sources": { evidence: evidence.revision } },
      },
    ]).state,
    "needs_review",
  );
});
test("authenticated API and agent context share the assessment and reads do not mutate records", async () => {
  const dir = mkdtempSync(join(tmpdir(), "titan-reliability-"));
  const instance = createApp({
    workspace: join(dir, "repo"),
    stateDir: join(dir, "state"),
    ownerToken: "qa-owner",
    workers: false,
  });
  const headers = { authorization: "Bearer qa-owner" };
  try {
    const create = async (payload: object) =>
      (
        await instance.app.inject({
          method: "POST",
          url: "/api/v1/units",
          headers,
          payload,
        })
      ).json();
    const claim = await create({
      kind: "knowledge",
      title: "Production guidance",
      body: "Use workload identity",
      applicability: ["production"],
    });
    const source = await create({
      kind: "evidence",
      title: "Identity test",
      body: "Identity passed",
      validity: "supported",
      authority: "observed",
    });
    const relation = await instance.app.inject({
      method: "POST",
      url: "/api/v1/relationships",
      headers,
      payload: {
        source: source.id,
        target: claim.id,
        type: "supports",
        evidence: [],
        justification: "Test supports guidance",
        revisions: { [source.id]: source.revision, [claim.id]: claim.revision },
      },
    });
    assert.equal(relation.statusCode, 200);
    const url = `/api/v1/units/${claim.id}/reliability?scope=production`;
    assert.equal((await instance.app.inject({ url })).statusCode, 401);
    const result = await instance.app.inject({ url, headers });
    assert.equal(result.statusCode, 200);
    assert.equal(result.json().state, "supported");
    assert.equal(result.json().revision, claim.revision);
    const context = instance.domain.context(
      { id: "reader", role: "agent", scopes: ["read"] },
      "Production",
      ["production"],
    );
    assert.deepEqual(
      context.find((r) => r.id === claim.id)?.reliability,
      result.json(),
    );
    assert.equal(
      (
        await instance.app.inject({ url: `/api/v1/units/${claim.id}`, headers })
      ).json().revision,
      claim.revision,
    );
    await instance.app.inject({
      method: "PATCH",
      url: `/api/v1/units/${source.id}`,
      headers,
      payload: { revision: source.revision, patch: { body: "New results" } },
    });
    assert.equal(
      (await instance.app.inject({ url, headers })).json().state,
      "needs_review",
    );
  } finally {
    await instance.app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("upstream support changes and support cycles cannot establish a reliable downstream basis", () => {
  const root = { ...evidence, id: "root", revision: "root-v1" };
  const upstream = {
    ...support,
    id: "upstream",
    source: root.id,
    target: evidence.id,
    revisions: { root: root.revision, evidence: evidence.revision },
  };
  assert.equal(
    assess(page, [page, evidence, root], [support, upstream]).state,
    "supported",
  );
  assert.equal(
    assess(
      page,
      [page, evidence, { ...root, revision: "root-v2" }],
      [support, upstream],
    ).state,
    "needs_review",
  );
  const cycle = {
    ...support,
    id: "cycle",
    source: evidence.id,
    target: root.id,
    revisions: upstream.revisions,
  };
  assert.equal(
    assess(page, [page, evidence, root], [support, upstream, cycle]).state,
    "needs_review",
  );
});
