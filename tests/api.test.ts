import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../apps/server/src/api.ts";
import {
  uid,
  type RecordView,
  type Event,
} from "../apps/server/src/contracts.ts";
const token = "owner-test-token";
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "titan-api-"));
  const api = createApp({
    workspace: join(dir, "repo"),
    stateDir: join(dir, "state"),
    ownerToken: token,
    workers: false,
  });
  return {
    dir,
    ...api,
    async close() {
      await api.app.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
const headers = { authorization: "Bearer " + token };
test("authentication, browser-origin checks and scoped integration tokens", async () => {
  const t = fixture();
  try {
    assert.equal(
      (await t.app.inject({ url: "/api/v1/units" })).statusCode,
      401,
    );
    const session = await t.app.inject({
      method: "POST",
      url: "/api/v1/session",
      headers,
    });
    assert.equal(session.statusCode, 200);
    const cookie = session.headers["set-cookie"] as string;
    assert.ok(cookie.includes("HttpOnly"));
    assert.equal(
      (
        await t.app.inject({
          method: "POST",
          url: "/api/v1/units",
          headers: { cookie, origin: "https://untrusted.example" },
          payload: { kind: "knowledge", title: "x", body: "x" },
        })
      ).statusCode,
      403,
    );
    const result = await t.app.inject({
      method: "POST",
      url: "/api/v1/tokens",
      headers,
      payload: { scopes: ["read"] },
    });
    const agent = { authorization: "Bearer " + result.json().token };
    assert.equal(
      (await t.app.inject({ url: "/api/v1/units", headers: agent })).statusCode,
      200,
    );
    assert.equal(
      (
        await t.app.inject({
          method: "POST",
          url: "/api/v1/units",
          headers: agent,
          payload: { kind: "knowledge", title: "x", body: "x" },
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (await t.app.inject({ url: "/api/v1/workspace", headers: agent }))
        .statusCode,
      403,
    );
  } finally {
    await t.close();
  }
});
test("API rejects unknown mutation fields and has no purge route", async () => {
  const t = fixture();
  try {
    const r = await t.app.inject({
      method: "POST",
      url: "/api/v1/units",
      headers,
      payload: { kind: "knowledge", title: "x", body: "x", secret: true },
    });
    assert.equal(r.statusCode, 422);
    assert.equal(
      (
        await t.app.inject({
          method: "POST",
          url: "/api/v1/purge",
          headers,
          payload: {},
        })
      ).statusCode,
      404,
    );
  } finally {
    await t.close();
  }
});
test("agent outcomes are idempotent and do not establish verification or completion", async () => {
  const t = fixture();
  try {
    const work = t.domain.create(
      { id: "owner", role: "human", scopes: ["*"] },
      { kind: "work", title: "Build", body: "Implement" },
    ) as RecordView;
    const agentToken = t.domain.index.token(["read", "write"]);
    const agentHeaders = { authorization: "Bearer " + agentToken };
    const payload = {
      eventId: uid(),
      workId: work.id,
      revision: work.revision,
      title: "Checks",
      body: "Workflow reports checks passed",
      verified: true,
    };
    const a = await t.app.inject({
      method: "POST",
      url: "/api/v1/outcomes",
      headers: agentHeaders,
      payload,
    });
    const b = await t.app.inject({
      method: "POST",
      url: "/api/v1/outcomes",
      headers: agentHeaders,
      payload,
    });
    assert.equal(a.statusCode, 200);
    assert.equal(a.json().id, b.json().id);
    assert.equal(a.json().validity, "unverified");
    const completion = await t.app.inject({
      method: "PATCH",
      url: "/api/v1/units/" + work.id,
      headers,
      payload: { revision: work.revision, patch: { status: "completed" } },
    });
    assert.equal(completion.statusCode, 422);
  } finally {
    await t.close();
  }
});
test("GitHub onboarding only accepts credential-free GitHub URLs", async () => {
  const t = fixture();
  try {
    for (const github of [
      "--upload-pack=malicious",
      "https://user:password@github.com/o/r",
      "https://other.example/o/r",
    ]) {
      const res = await t.app.inject({
        method: "POST",
        url: "/api/v1/workspace",
        headers,
        payload: { github },
      });
      assert.equal(res.statusCode, 422);
    }
  } finally {
    await t.close();
  }
});
test("assistant status and removal previews bind to the selected revision", async () => {
  const t = fixture();
  try {
    const u = t.domain.create(
      { id: "owner", role: "human", scopes: ["*"] },
      { kind: "work", title: "Build", body: "Implement" },
    ) as RecordView;
    const payload = {
      id: u.id,
      revision: u.revision,
      instruction: "Mark this work ready",
    };
    const response = await t.app.inject({
      method: "POST",
      url: "/api/v1/author",
      headers,
      payload,
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().draft.patch.status, "ready");
    assert.equal(
      t.domain.get({ id: "owner", role: "human", scopes: ["*"] }, u.id).status,
      "draft",
    );
    const stale = await t.app.inject({
      method: "POST",
      url: "/api/v1/author",
      headers,
      payload: { ...payload, revision: "stale" },
    });
    assert.equal(stale.statusCode, 409);
  } finally {
    await t.close();
  }
});

test("composer drafts stay private, survive restart, and publish exact content through the record pipeline", async () => {
  const t = fixture();
  const draftId = uid();
  const content = {
    kind: "knowledge",
    title: "2027 company calendar",
    body: "| Date | Event |\n| --- | --- |\n| 2027-01-01 | Office closed |\n\nThe office closes at noon.\n",
    applicability: ["US employees"],
    source: null,
  };
  let restarted: ReturnType<typeof createApp> | undefined;
  try {
    const response = await t.app.inject({
      method: "PUT",
      url: `/api/v1/composer-drafts/${draftId}`,
      headers,
      payload: { version: 0, content },
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().version, 1);
    assert.equal(
      t.domain.records({ id: "owner", role: "human", scopes: ["*"] }).length,
      0,
    );
    assert.equal(
      t.domain.context(
        { id: "agent", role: "agent", scopes: ["read"] },
        "calendar",
      ).length,
      0,
    );
    assert.equal(t.domain.index.jobs().length, 0);
    const agentHeaders = {
      authorization: "Bearer " + t.domain.index.token(["read", "write"]),
    };
    for (const method of ["GET", "PUT", "DELETE", "POST"] as const) {
      const url =
        method === "GET"
          ? "/api/v1/composer-drafts"
          : `/api/v1/composer-drafts/${draftId}${method === "POST" ? "/publish" : ""}`;
      const result = await t.app.inject({
        method,
        url,
        headers: agentHeaders,
        ...(method === "GET"
          ? {}
          : {
              payload:
                method === "PUT" ? { version: 1, content } : { version: 1 },
            }),
      });
      assert.equal(result.statusCode, 403);
    }
    await t.app.close();
    restarted = createApp({
      workspace: join(t.dir, "repo"),
      stateDir: join(t.dir, "state"),
      ownerToken: token,
      workers: false,
    });
    const drafts = await restarted.app.inject({
      url: "/api/v1/composer-drafts",
      headers,
    });
    assert.equal(drafts.json()[0].body, content.body);
    const publish = await restarted.app.inject({
      method: "POST",
      url: `/api/v1/composer-drafts/${draftId}/publish`,
      headers,
      payload: { version: 1 },
    });
    assert.equal(publish.statusCode, 200);
    const unit = publish.json();
    assert.equal(unit.id, draftId);
    assert.equal(unit.title, content.title);
    assert.equal(unit.body, content.body);
    assert.deepEqual(unit.applicability, content.applicability);
    assert.equal(unit.validity, "unverified");
    assert.equal(unit.authority, "hypothesis");
    assert.equal(restarted.domain.index.jobs().length, 1);
    assert.equal(restarted.domain.index.jobs()[0].kind, "infer");
    assert.equal(
      restarted.domain.context(
        { id: "agent", role: "agent", scopes: ["read"] },
        "calendar",
      )[0].id,
      unit.id,
    );
    assert.equal(
      (
        await restarted.app.inject({ url: "/api/v1/composer-drafts", headers })
      ).json().length,
      0,
    );
    // Recover even if the local publication receipt was lost after the Git commit.
    restarted.domain.index.db
      .prepare("UPDATE composer_drafts SET published_id=NULL WHERE id=?")
      .run(draftId);
    const retry = await restarted.app.inject({
      method: "POST",
      url: `/api/v1/composer-drafts/${draftId}/publish`,
      headers,
      payload: { version: 1 },
    });
    assert.equal(retry.statusCode, 200);
    assert.equal(retry.json().revision, unit.revision);
    assert.equal(restarted.domain.index.jobs().length, 1);
    assert.equal(
      restarted.domain
        .audit({ id: "owner", role: "human", scopes: ["*"] })
        .find(
          (event) =>
            event.operation === "create" && event.entities.includes(draftId),
        )!.actor.role,
      "human",
    );
  } finally {
    if (restarted) await restarted.app.close();
    else await t.app.close();
    rmSync(t.dir, { recursive: true, force: true });
  }
});

test("composer rejects stale drafts and page revisions without losing unpublished changes", async () => {
  const t = fixture();
  const owner = { id: "owner", role: "human" as const, scopes: ["*"] };
  try {
    const unit = t.domain.create(owner, {
      kind: "knowledge",
      title: "Closures",
      body: "Original",
      status: "accepted",
      authority: "approved",
      validity: "supported",
      extensions: { "company:category": "HR" },
    }) as RecordView;
    const draftId = uid();
    const content = {
      kind: "knowledge",
      title: unit.title,
      body: "Human’s precise wording",
      applicability: ["US"],
      source: { id: unit.id, revision: unit.revision },
    };
    const save = (version: number, value = content) =>
      t.app.inject({
        method: "PUT",
        url: `/api/v1/composer-drafts/${draftId}`,
        headers,
        payload: { version, content: value },
      });
    assert.equal((await save(0)).statusCode, 200);
    assert.equal((await save(0)).statusCode, 409);
    assert.equal(
      (await save(1, { ...content, body: "Revised wording" })).statusCode,
      200,
    );
    assert.equal(
      (
        await t.app.inject({
          method: "POST",
          url: `/api/v1/composer-drafts/${draftId}/publish`,
          headers,
          payload: { version: 1 },
        })
      ).statusCode,
      409,
    );
    const published = await t.app.inject({
      method: "POST",
      url: `/api/v1/composer-drafts/${draftId}/publish`,
      headers,
      payload: { version: 2 },
    });
    assert.equal(published.statusCode, 200);
    assert.equal(published.json().id, unit.id);
    assert.equal(published.json().body, "Revised wording");
    assert.equal(published.json().status, "accepted");
    assert.equal(published.json().authority, "approved");
    assert.equal(published.json().extensions["company:category"], "HR");
    assert.ok(t.domain.history(owner, unit.id).length >= 2);
    const staleId = uid();
    const current = published.json();
    const staleContent = {
      ...content,
      source: { id: unit.id, revision: current.revision },
      body: "Unpublished changes",
    };
    assert.equal(
      (
        await t.app.inject({
          method: "PUT",
          url: `/api/v1/composer-drafts/${staleId}`,
          headers,
          payload: { version: 0, content: staleContent },
        })
      ).statusCode,
      200,
    );
    t.domain.edit(owner, unit.id, current.revision, {
      body: "Changed elsewhere",
    });
    const conflict = await t.app.inject({
      method: "POST",
      url: `/api/v1/composer-drafts/${staleId}/publish`,
      headers,
      payload: { version: 1 },
    });
    assert.equal(conflict.statusCode, 409);
    assert.equal(t.domain.get(owner, unit.id).body, "Changed elsewhere");
    assert.equal(t.domain.composerDrafts(owner)[0].body, "Unpublished changes");
    const latest = t.domain.get(owner, unit.id);
    const staleRebase = await t.app.inject({
      method: "POST",
      url: `/api/v1/composer-drafts/${staleId}/rebase`,
      headers,
      payload: { version: 1, revision: current.revision },
    });
    assert.equal(staleRebase.statusCode, 409);
    const rebased = await t.app.inject({
      method: "POST",
      url: `/api/v1/composer-drafts/${staleId}/rebase`,
      headers,
      payload: { version: 1, revision: latest.revision },
    });
    assert.equal(rebased.statusCode, 200);
    assert.equal(rebased.json().version, 2);
    assert.equal(rebased.json().body, "Unpublished changes");
    assert.equal(t.domain.get(owner, unit.id).body, "Changed elsewhere");

    assert.equal(
      (
        await t.app.inject({
          method: "DELETE",
          url: `/api/v1/composer-drafts/${staleId}`,
          headers,
          payload: { version: 1 },
        })
      ).statusCode,
      409,
    );
    assert.equal(
      (
        await t.app.inject({
          method: "DELETE",
          url: `/api/v1/composer-drafts/${staleId}`,
          headers,
          payload: { version: 2 },
        })
      ).statusCode,
      200,
    );
    assert.equal(t.domain.composerDrafts(owner).length, 0);
  } finally {
    await t.close();
  }
});

test("empty composer drafts can be saved but cannot be published; drafts are workspace-local", async () => {
  const t = fixture();
  try {
    const draftId = uid();
    const content = {
      kind: "knowledge",
      title: "",
      body: "",
      applicability: [],
      source: null,
    };
    assert.equal(
      (
        await t.app.inject({
          method: "PUT",
          url: `/api/v1/composer-drafts/${draftId}`,
          headers,
          payload: { version: 0, content },
        })
      ).statusCode,
      200,
    );
    assert.equal(
      (
        await t.app.inject({
          method: "POST",
          url: `/api/v1/composer-drafts/${draftId}/publish`,
          headers,
          payload: { version: 1 },
        })
      ).statusCode,
      422,
    );
    assert.equal(
      (
        await t.app.inject({
          method: "POST",
          url: "/api/v1/workspace",
          headers,
          payload: { path: join(t.dir, "other-repo") },
        })
      ).statusCode,
      200,
    );
    assert.equal(
      (await t.app.inject({ url: "/api/v1/composer-drafts", headers })).json()
        .length,
      0,
    );
    await t.app.inject({
      method: "POST",
      url: "/api/v1/workspace",
      headers,
      payload: { path: join(t.dir, "repo") },
    });
    assert.equal(
      (
        await t.app.inject({ url: "/api/v1/composer-drafts", headers })
      ).json()[0].id,
      draftId,
    );
  } finally {
    await t.close();
  }
});

test("composer preserves a stale first autosave and drafts of removed pages", async () => {
  const t = fixture();
  const owner = { id: "owner", role: "human" as const, scopes: ["*"] };
  try {
    const unit = t.domain.create(owner, {
      kind: "knowledge",
      title: "Calendar",
      body: "Original",
    }) as RecordView;
    const newer = t.domain.edit(owner, unit.id, unit.revision, {
      body: "Newer published content",
    }) as RecordView;
    const content = {
      kind: "knowledge",
      title: unit.title,
      body: "Unsaved human work",
      applicability: [],
      source: { id: unit.id, revision: unit.revision },
    };
    const draftId = uid();
    const save = await t.app.inject({
      method: "PUT",
      url: `/api/v1/composer-drafts/${draftId}`,
      headers,
      payload: { version: 0, content },
    });
    assert.equal(save.statusCode, 200);
    const conflict = await t.app.inject({
      method: "POST",
      url: `/api/v1/composer-drafts/${draftId}/publish`,
      headers,
      payload: { version: 1 },
    });
    assert.equal(conflict.statusCode, 409);
    const agent = {
      authorization: "Bearer " + t.domain.index.token(["read", "write"]),
    };
    assert.equal(
      (
        await t.app.inject({
          method: "POST",
          url: `/api/v1/composer-drafts/${draftId}/rebase`,
          headers: agent,
          payload: { version: 1, revision: newer.revision },
        })
      ).statusCode,
      403,
    );
    t.domain.remove(owner, unit.id, newer.revision, "Remove source");
    const retained = await t.app.inject({
      method: "PUT",
      url: `/api/v1/composer-drafts/${draftId}`,
      headers,
      payload: {
        version: 1,
        content: { ...content, body: "Human work after removal" },
      },
    });
    assert.equal(retained.statusCode, 200);
    assert.equal(
      (
        await t.app.inject({
          method: "POST",
          url: `/api/v1/composer-drafts/${draftId}/publish`,
          headers,
          payload: { version: 2 },
        })
      ).statusCode,
      404,
    );
    assert.equal(
      t.domain.composerDrafts(owner)[0].body,
      "Human work after removal",
    );
  } finally {
    await t.close();
  }
});

test("record write provenance binds the editor to the resulting revision", async () => {
  const t = fixture();
  try {
    const created = await t.app.inject({
      method: "POST",
      url: "/api/v1/units",
      headers,
      payload: {
        kind: "knowledge",
        title: "Company calendar",
        body: "Initial dates",
      },
    });
    assert.equal(created.statusCode, 200);
    const before = created.json();
    const edited = await t.app.inject({
      method: "PATCH",
      url: "/api/v1/units/" + before.id,
      headers,
      payload: { revision: before.revision, patch: { body: "Updated dates" } },
    });
    assert.equal(edited.statusCode, 200);
    const after = edited.json();
    const events: Event[] = (
      await t.app.inject({ url: "/api/v1/audit", headers })
    ).json();
    const write = events.find(
      (event) =>
        event.operation === "edit" && event.entities.includes(before.id),
    );
    assert.ok(write);
    assert.equal(write.actor.id, "owner");
    assert.equal(write.revisions[before.id], before.revision);
    assert.equal(write.resultingRevisions?.[before.id], after.revision);
    const creation = events.find(
      (event) =>
        event.operation === "create" && event.entities.includes(before.id),
    );
    assert.ok(creation);
    assert.equal(creation.resultingRevisions?.[before.id], before.revision);
  } finally {
    await t.close();
  }
});

test("intelligence credentials are owner-only, private, and survive reopening", async () => {
  const t = fixture();
  try {
    const url = "/api/v1/intelligence/credentials";
    assert.equal(
      (
        await t.app.inject({
          method: "PUT",
          url,
          payload: { provider: "openai", apiKey: "test-secret" },
        })
      ).statusCode,
      401,
    );
    const saved = await t.app.inject({
      method: "PUT",
      url,
      headers,
      payload: { provider: "openai", apiKey: "test-secret" },
    });
    assert.equal(saved.statusCode, 200);
    assert.equal(saved.json().openai, true);
    const workspace = await t.app.inject({ url: "/api/v1/workspace", headers });
    assert.equal(workspace.json().credentials.openai, true);
    assert.ok(!workspace.body.includes("test-secret"));
    const { Intelligence } = await import("../apps/server/src/intelligence.ts");
    const reopened = new Intelligence(t.domain, t.intelligence.stateDir);
    assert.equal(reopened.credentials().OPENAI_API_KEY, "test-secret");
    const { statSync } = await import("node:fs");
    assert.equal(
      statSync(join(t.intelligence.stateDir, "provider-credentials.json"))
        .mode & 0o777,
      0o600,
    );
    const scoped = await t.app.inject({
      method: "POST",
      url: "/api/v1/tokens",
      headers,
      payload: { scopes: ["read", "write"] },
    });
    assert.equal(
      (
        await t.app.inject({
          method: "PUT",
          url,
          headers: { authorization: "Bearer " + scoped.json().token },
          payload: { provider: "openai", apiKey: "other-secret" },
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await t.app.inject({
          method: "PUT",
          url,
          headers,
          payload: { provider: "openai", apiKey: "bad key" },
        })
      ).statusCode,
      422,
    );
    await t.app.inject({
      method: "PUT",
      url,
      headers,
      payload: { provider: "openai", apiKey: "" },
    });
    assert.equal(reopened.credentials().OPENAI_API_KEY, undefined);
    const unsafe = new Intelligence(
      t.domain,
      join(t.domain.storage.root, "private-state"),
    );
    assert.throws(
      () => unsafe.saveCredential("openai", "secret"),
      /outside the workspace/,
    );
  } finally {
    await t.close();
  }
});

test("custom provider settings persist and validate API endpoints", async () => {
  const t = fixture();
  try {
    const patch = {
      provider: "custom",
      credentialRef: "CUSTOM_API_KEY",
      model: "local-model",
      providerBaseUrl: "http://localhost:1234/v1",
    };
    const saved = await t.app.inject({
      method: "PATCH",
      url: "/api/v1/settings",
      headers,
      payload: patch,
    });
    assert.equal(saved.statusCode, 200);
    assert.equal(saved.json().providerBaseUrl, patch.providerBaseUrl);
    for (const providerBaseUrl of [
      "",
      "http://remote.example/v1",
      "https://user:secret@example.com/v1",
      "https://example.com/v1?key=secret",
    ]) {
      assert.equal(
        (
          await t.app.inject({
            method: "PATCH",
            url: "/api/v1/settings",
            headers,
            payload: { ...patch, providerBaseUrl },
          })
        ).statusCode,
        422,
      );
    }
    await t.app.inject({
      method: "PUT",
      url: "/api/v1/intelligence/credentials",
      headers,
      payload: { provider: "custom", apiKey: "custom-secret" },
    });
    assert.equal(t.intelligence.credentials().CUSTOM_API_KEY, "custom-secret");
    const status = await t.app.inject({ url: "/api/v1/workspace", headers });
    assert.equal(status.json().credentials.custom, true);
    assert.ok(!status.body.includes("custom-secret"));
  } finally {
    await t.close();
  }
});
