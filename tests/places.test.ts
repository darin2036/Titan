import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../apps/server/src/api.ts";
import { OWNER } from "../apps/server/src/domain.ts";
import { type RecordView, uid } from "../apps/server/src/contracts.ts";

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "titan-places-"));
  const api = createApp({
    workspace: join(dir, "repo"),
    stateDir: join(dir, "state"),
    ownerToken: "places-test",
    workers: false,
  });
  return {
    ...api,
    async close() {
      await api.app.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
const headers = { authorization: "Bearer places-test" };
const content = (memberIds: string[], pinnedIds: string[] = []) => ({
  name: "Onboarding",
  type: "Project",
  organization: "assisted",
  memberIds,
  pinnedIds,
});

test("places persist, share record identities, and reject stale or invalid organization", async () => {
  const t = fixture();
  try {
    const record = t.domain.create(OWNER, {
      kind: "knowledge",
      title: "PRD",
      body: "Requirements",
    }) as RecordView;
    const a = t.domain.savePlace(OWNER, content([record.id], [record.id]));
    const b = t.domain.savePlace(OWNER, {
      ...content([record.id]),
      type: "Team",
    });
    t.domain.reconcile();
    assert.equal(t.domain.places(OWNER).length, 2);
    assert.equal(t.domain.get(OWNER, record.id).revision, record.revision);
    assert.ok(t.domain.storage.read(`.titan/places/${a.id}.json`));
    const updated = t.domain.savePlace(
      OWNER,
      { ...content([record.id]), name: "Activation", organization: "manual" },
      a.id,
      a.revision,
    );
    assert.notEqual(updated.revision, a.revision);
    assert.throws(
      () => t.domain.savePlace(OWNER, content([record.id]), a.id, a.revision),
      /another window/,
    );
    assert.equal(
      t.domain.places(OWNER).find((p) => p.id === b.id)?.memberIds[0],
      record.id,
    );
    for (const payload of [
      content([], [record.id]),
      content([record.id, record.id]),
      content([uid()]),
    ]) {
      const response = await t.app.inject({
        method: "POST",
        url: "/api/v1/places",
        headers,
        payload,
      });
      assert.ok(response.statusCode >= 400);
    }
    const agent = {
      authorization: "Bearer " + t.domain.index.token(["read", "write"]),
    };
    assert.equal(
      (await t.app.inject({ url: "/api/v1/places", headers: agent }))
        .statusCode,
      403,
    );
    assert.equal(
      (
        await t.app.inject({
          method: "POST",
          url: "/api/v1/places",
          headers: agent,
          payload: content([]),
        })
      ).statusCode,
      403,
    );
    const removed = t.domain.remove(
      OWNER,
      record.id,
      record.revision,
      "Owner removed record",
    );
    assert.ok(removed);
    assert.deepEqual(
      t.domain.places(OWNER).find((p) => p.id === b.id)?.memberIds,
      [record.id],
    );
  } finally {
    await t.close();
  }
});

test("assisted suggestions require current accepted connections and never alter membership or pins", async () => {
  const t = fixture();
  try {
    const a = t.domain.create(OWNER, {
      kind: "knowledge",
      title: "PRD",
      body: "Requirements",
    }) as RecordView;
    const b = t.domain.create(OWNER, {
      kind: "work",
      title: "Build",
      body: "Implement",
    }) as RecordView;
    const c = t.domain.create(OWNER, {
      kind: "evidence",
      title: "Checks",
      body: "Checks passed",
    }) as RecordView;
    const place = t.domain.savePlace(OWNER, content([a.id], [a.id]));
    t.domain.relate(OWNER, {
      source: b.id,
      target: a.id,
      type: "implements",
      justification: "Work implements the PRD",
      evidence: [c.id],
      revisions: { [a.id]: a.revision, [b.id]: b.revision, [c.id]: c.revision },
    });
    let view = t.domain.places(OWNER)[0];
    assert.equal(view.suggestions[0].recordId, b.id);
    assert.equal(
      view.suggestions[0].connections[0].justification,
      "Work implements the PRD",
    );
    assert.deepEqual(view.memberIds, [a.id]);
    assert.deepEqual(view.pinnedIds, [a.id]);
    assert.equal(view.revision, place.revision);
    const manual = t.domain.savePlace(
      OWNER,
      { ...content([a.id], [a.id]), organization: "manual" },
      place.id,
      place.revision,
    );
    assert.deepEqual(manual.suggestions, []);
    t.domain.savePlace(
      OWNER,
      content([a.id], [a.id]),
      place.id,
      manual.revision,
    );
    t.domain.edit(OWNER, c.id, c.revision, { body: "Checks need revision" });
    view = t.domain.places(OWNER)[0];
    assert.deepEqual(view.suggestions, []);
    assert.deepEqual(view.pinnedIds, [a.id]);
  } finally {
    await t.close();
  }
});

test("place authoring supplies exact sources and refuses publication after a source changes", async () => {
  const t = fixture();
  try {
    const source = t.domain.create(OWNER, {
      kind: "knowledge",
      title: "PRD",
      body: "Requirements",
    }) as RecordView;
    const place = t.domain.savePlace(OWNER, content([source.id]));
    t.intelligence.author = async (input) => {
      assert.deepEqual(
        input.sources?.map((u) => u.id),
        [source.id],
      );
      return {
        title: "Overview",
        kind: "knowledge",
        body: "Source-based summary",
        justification: "Summary for review",
      };
    };
    const response = await t.app.inject({
      method: "POST",
      url: "/api/v1/author",
      headers,
      payload: { instruction: "Draft overview", placeId: place.id },
    });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json().sources, { [source.id]: source.revision });
    t.domain.edit(OWNER, source.id, source.revision, {
      body: "Updated requirements",
    });
    const stale = await t.app.inject({
      method: "POST",
      url: "/api/v1/units",
      headers,
      payload: {
        kind: "knowledge",
        title: "Overview",
        body: "Stale summary",
        extensions: { "titan:sources": response.json().sources },
      },
    });
    assert.equal(stale.statusCode, 409);
    assert.equal(t.domain.records(OWNER).length, 1);
  } finally {
    await t.close();
  }
});

test("custom place groupings persist and legacy places retain all groupings", async () => {
  const t = fixture();
  try {
    const { placeGroupings } = await import("../apps/shared/places.ts");
    const legacy = t.domain.savePlace(OWNER, {
      ...content([]),
      type: "Information",
    });
    assert.deepEqual(placeGroupings(legacy), [
      "knowledge",
      "work",
      "decision",
      "evidence",
    ]);
    const created = t.domain.savePlace(OWNER, {
      ...content([]),
      type: "Information",
      groupings: ["knowledge"],
    });
    assert.deepEqual(
      t.domain.places(OWNER).find((p) => p.id === created.id)?.groupings,
      ["knowledge"],
    );
    assert.deepEqual(placeGroupings(created), ["knowledge"]);
    const updated = t.domain.savePlace(
      OWNER,
      {
        ...content([]),
        type: "Information",
        groupings: ["knowledge", "evidence"],
      },
      created.id,
      created.revision,
    );
    assert.deepEqual(placeGroupings(updated), ["knowledge", "evidence"]);
    assert.deepEqual(
      placeGroupings({ type: "Team", groupings: ["knowledge"] }),
      ["knowledge", "work", "decision", "evidence"],
    );
    for (const groupings of [[], ["unknown"], ["knowledge", "knowledge"]]) {
      const response = await t.app.inject({
        method: "POST",
        url: "/api/v1/places",
        headers,
        payload: { ...content([]), type: "Information", groupings },
      });
      assert.equal(response.statusCode, 422);
    }
  } finally {
    await t.close();
  }
});
