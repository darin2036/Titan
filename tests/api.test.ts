import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../apps/server/src/api.ts";
import { uid, type RecordView } from "../apps/server/src/contracts.ts";
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
