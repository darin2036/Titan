import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createApp } from "../apps/server/src/api.ts";
import { OWNER } from "../apps/server/src/domain.ts";
import { ConnectedStorage } from "../apps/server/src/connected-storage.ts";
import {
  normalizeConfluence,
  confluenceMarkup,
} from "../apps/server/src/confluence-content.ts";
import { uid } from "../apps/server/src/contracts.ts";
import { encode } from "../apps/server/src/storage.ts";
const headers = { authorization: "Bearer test-owner" };
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "titan-confluence-"));
  let page = {
    id: "12",
    spaceId: "7",
    status: "current",
    title: "Company guidance",
    createdAt: "2026-10-05T12:00:00Z",
    version: {
      number: 1,
      createdAt: "2026-10-05T12:00:00Z",
      authorId: "source-author",
    },
    body: {
      storage: {
        value: "<h2>Purpose</h2><p>Use <strong>workload identity</strong>.</p>",
      },
    },
    _links: { webui: "/wiki/spaces/TEAM/pages/12" },
  };
  let listed = true;
  let metadataOnly = false;
  let failure = 0;
  let next: string | undefined;
  let puts = 0;
  let uncertainWrite = false;
  let refreshed = 0;
  const calls: string[] = [];
  const response = (value: unknown, status = 200, extra = {}) =>
    new Response(JSON.stringify(value), {
      status,
      headers: { "Content-Type": "application/json", ...extra },
    });
  const request: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push(url);
    if (url === "https://auth.atlassian.com/oauth/token") {
      const body = JSON.parse(String(init?.body));
      if (body.grant_type === "refresh_token") refreshed++;
      return response({
        access_token: "private-access-token",
        refresh_token: "private-refresh-token",
        expires_in: 3600,
        scope:
          "offline_access read:space:confluence read:page:confluence write:page:confluence",
      });
    }
    if (url.endsWith("accessible-resources"))
      return response([
        {
          id: "cloud",
          name: "Company",
          url: "https://company.atlassian.net",
          scopes: [
            "read:space:confluence",
            "read:page:confluence",
            "write:page:confluence",
          ],
        },
      ]);
    assert.ok(
      url.startsWith("https://api.atlassian.com/ex/confluence/cloud/wiki/"),
    );
    assert.equal(
      (init?.headers as any).Authorization,
      "Bearer private-access-token",
    );
    if (failure)
      return response(
        {},
        failure,
        failure === 429 ? { "Retry-After": "30" } : {},
      );
    if (url.includes("/spaces?"))
      return response({ results: [{ id: "7", name: "Team", key: "TEAM" }] });
    if (init?.method === "PUT") {
      puts++;
      const body = JSON.parse(String(init.body));
      assert.equal(body.version.number, page.version.number + 1);
      page = {
        ...page,
        title: body.title,
        version: { ...page.version, number: body.version.number },
        body: { storage: { value: body.body.value } },
      };
      if (uncertainWrite) {
        uncertainWrite = false;
        throw new Error("Connection lost after successful remote write");
      }
      return response(page);
    }
    if (url.includes("/pages/12"))
      return listed ? response(page) : response({}, 404);
    if (url.includes("/pages?"))
      return response({
        results: listed
          ? [metadataOnly ? { ...page, body: undefined } : page]
          : [],
        _links: next ? { next } : {},
      });
    throw new Error("Unexpected request " + url);
  };
  const options = {
    workspace: join(dir, "repo"),
    stateDir: join(dir, "state"),
    ownerToken: "test-owner",
    workers: false,
    confluence: {
      clientId: "titan-app",
      clientSecret: "operator-secret",
      redirectUri:
        "http://127.0.0.1:4310/api/v1/integrations/confluence/callback",
      fetch: request,
    },
  };
  let instance = createApp(options);
  const route = "/api/v1/integrations/confluence";
  return {
    dir,
    get instance() {
      return instance;
    },
    async restart() {
      await instance.app.close();
      instance = createApp(options);
    },
    calls,
    route,
    get page() {
      return page;
    },
    set page(v) {
      page = v;
    },
    get puts() {
      return puts;
    },
    get refreshed() {
      return refreshed;
    },
    set uncertainWrite(v: boolean) {
      uncertainWrite = v;
    },
    set metadataOnly(v: boolean) {
      metadataOnly = v;
    },
    set listed(v: boolean) {
      listed = v;
    },
    set failure(v: number) {
      failure = v;
    },
    set next(v: string | undefined) {
      next = v;
    },
    async connect(allowEdits = false) {
      const auth = await instance.app.inject({
        method: "POST",
        url: route + "/authorize",
        headers,
        payload: { allowEdits },
      });
      assert.equal(auth.statusCode, 200);
      const url = new URL(auth.json().url);
      assert.equal(url.origin, "https://auth.atlassian.com");
      const callback = await instance.app.inject({
        url:
          route +
          "/callback?state=" +
          url.searchParams.get("state") +
          "&code=authorization-code",
      });
      assert.equal(callback.statusCode, 302);
      assert.ok(callback.headers.location?.includes("connected"));
      const configured = await instance.app.inject({
        method: "PUT",
        url: route,
        headers,
        payload: {
          siteId: "cloud",
          spaces: ["7"],
          allowEdits,
          intervalMinutes: 5,
        },
      });
      assert.equal(configured.statusCode, 200, configured.body);
      await instance.confluence.tick();
      assert.equal(instance.confluence.status().error, null);
      return instance.domain.records(OWNER)[0];
    },
    async sync() {
      instance.confluence.schedule();
      await instance.confluence.tick();
    },
    async close() {
      await instance.app.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
test("storage-format content normalizes without executing macros and safe Markdown writes preserve common content", () => {
  const content = normalizeConfluence(
    '<h2>Guide</h2><p><strong>Bold</strong> and <em>italic</em> <a href="https://example.com">source</a></p><table><tbody><tr><th>A</th><th>B</th></tr><tr><td>one</td><td>two</td></tr></tbody></table>',
  );
  assert.equal(content.issues.length, 0);
  assert.ok(
    normalizeConfluence('<p style="color: red">Styled text</p>').issues.length,
  );
  assert.match(content.body, /## Guide/);
  assert.match(content.body, /\| one \| two \|/);
  assert.equal(
    normalizeConfluence(confluenceMarkup(content.body)).issues.length,
    0,
  );
  assert.ok(
    normalizeConfluence(
      '<ac:structured-macro ac:name="code"><ac:plain-text-body><![CDATA[secret]]></ac:plain-text-body></ac:structured-macro>',
    ).issues.length,
  );
  assert.ok(
    normalizeConfluence(
      '<!DOCTYPE page [<!ENTITY x SYSTEM "file:///etc/passwd">]><p>&x;</p>',
    ).issues.length,
  );
  assert.throws(() => confluenceMarkup("<script>alert(1)</script>"));
  assert.throws(() => confluenceMarkup("[unsafe](javascript:alert(1))"));
});
test("OAuth state is authenticated, single-use, expiring and credentials stay out of public responses and Git", async () => {
  const f = fixture();
  try {
    assert.equal(
      (
        await f.instance.app.inject({
          method: "POST",
          url: f.route + "/authorize",
          payload: {},
        })
      ).statusCode,
      401,
    );
    assert.ok(
      (
        await f.instance.app.inject({
          url: f.route + "/callback?state=wrong&code=x",
        })
      ).headers.location?.includes("error"),
    );
    const record = await f.connect();
    assert.ok(record);
    const status = (await f.instance.app.inject({ url: f.route, headers }))
      .body;
    assert.ok(!status.includes("token"));
    assert.ok(!status.includes("operator-secret"));
    const state = (f.instance.domain.storage as ConnectedStorage).state<any>(
      "oauth",
    );
    assert.equal(state, null);
    const secret = (f.instance.domain.storage as ConnectedStorage).state<any>(
      "tokens",
    );
    assert.ok(
      secret.data && !JSON.stringify(secret).includes("private-access-token"),
    );
    const gitFiles = execFileSync(
      "git",
      ["-C", join(f.dir, "repo"), "ls-files"],
      { encoding: "utf8" },
    );
    assert.ok(!gitFiles.includes(record.id));
    const log = execFileSync("git", ["-C", join(f.dir, "repo"), "log", "-p"], {
      encoding: "utf8",
    });
    assert.ok(
      !log.includes("Company guidance") &&
        !log.includes("private-access-token"),
    );
  } finally {
    await f.close();
  }
});
test("ingestion preserves stable IDs, Titan metadata and revisions across unchanged polling, external updates and reconnection", async () => {
  const f = fixture();
  try {
    const before = await f.connect();
    assert.equal(before.validity, "unverified");
    assert.match(before.body, /workload identity/);
    const metadata = f.instance.domain.edit(OWNER, before.id, before.revision, {
      applicability: ["production"],
    }) as any;
    const events = f.instance.domain.audit(OWNER).length;
    await f.sync();
    const same = f.instance.domain.get(OWNER, before.id);
    assert.equal(same.revision, metadata.revision);
    assert.equal(f.instance.domain.audit(OWNER).length, events);
    f.page = {
      ...f.page,
      title: "Renamed guidance",
      version: { ...f.page.version, number: 2 },
    };
    await f.sync();
    const updated = f.instance.domain.get(OWNER, before.id);
    assert.equal(updated.id, before.id);
    assert.deepEqual(updated.applicability, ["production"]);
    assert.notEqual(updated.revision, same.revision);
    f.instance.confluence.disconnect();
    assert.equal(f.instance.domain.records(OWNER, true).length, 0);
    const connected = await f.connect();
    assert.equal(connected.id, before.id);
    assert.deepEqual(connected.applicability, ["production"]);
  } finally {
    await f.close();
  }
});
test("disconnect, missing pages, lease expiry and source access loss remove connected knowledge and dependent summaries from all reads", async () => {
  const f = fixture();
  try {
    const record = await f.connect();
    const summary = f.instance.domain.create(OWNER, {
      kind: "knowledge",
      title: "Summary",
      body: "Restricted summary",
      extensions: { "titan:sources": { [record.id]: record.revision } },
    }) as any;
    assert.equal(f.instance.domain.records(OWNER).length, 2);
    f.listed = false;
    await f.sync();
    assert.equal(f.instance.domain.records(OWNER, true).length, 0);
    assert.equal(f.instance.domain.context(OWNER, "Restricted").length, 0);
    assert.throws(() => f.instance.domain.history(OWNER, record.id));
    assert.throws(() => f.instance.domain.get(OWNER, summary.id, true));
    assert.equal(f.instance.domain.audit(OWNER).length, 0);
    f.listed = true;
    await f.sync();
    assert.equal(f.instance.domain.records(OWNER).length, 2);
    const storage = f.instance.domain.storage as ConnectedStorage;
    storage.db
      .prepare("UPDATE bindings SET checked=?")
      .run(Date.now() - 16 * 60_000);
    assert.equal(f.instance.domain.records(OWNER, true).length, 0);
    await f.sync();
    assert.equal(f.instance.domain.records(OWNER).length, 2);
    f.failure = 401;
    await f.sync();
    assert.equal(f.instance.domain.records(OWNER, true).length, 0);
  } finally {
    await f.close();
  }
});
test("read-only connection blocks content edits; write-back rejects remote conflicts and retains drafts", async () => {
  const f = fixture();
  try {
    const record = await f.connect();
    assert.throws(() =>
      f.instance.domain.edit(OWNER, record.id, record.revision, {
        body: "Bypass",
      }),
    );
    assert.throws(() =>
      f.instance.domain.edit(OWNER, record.id, record.revision, {
        extensions: { "titan:confluence": { owner: "titan" } },
      }),
    );
    const draft = f.instance.domain.saveComposerDraft(OWNER, uid(), 0, {
      kind: record.kind,
      title: "New guidance",
      body: "New text",
      applicability: [],
      source: { id: record.id, revision: record.revision },
    });
    await assert.rejects(
      f.instance.confluence.publishDraft(draft.id, draft.version),
      /read only/,
    );
    assert.equal(f.puts, 0);
    await f.instance.confluence.configure({
      siteId: "cloud",
      spaces: ["7"],
      allowEdits: true,
    });
    await f.instance.confluence.tick();
    f.page = { ...f.page, version: { ...f.page.version, number: 2 } };
    await assert.rejects(
      f.instance.confluence.publishDraft(draft.id, draft.version),
      /changed/,
    );
    assert.equal(f.puts, 0);
    assert.equal(f.instance.domain.composerDrafts(OWNER).length, 1);
  } finally {
    await f.close();
  }
});
test("uncertain remote writes recover by inspecting source version and content without publishing twice", async () => {
  const f = fixture();
  try {
    const record = await f.connect(true);
    const draft = f.instance.domain.saveComposerDraft(OWNER, uid(), 0, {
      kind: record.kind,
      title: "New guidance",
      body: "New **text**",
      applicability: ["production"],
      source: { id: record.id, revision: record.revision },
    });
    f.uncertainWrite = true;
    await assert.rejects(
      f.instance.confluence.publishDraft(draft.id, draft.version),
    );
    assert.equal(f.puts, 1);
    const saved = await f.instance.confluence.publishDraft(
      draft.id,
      draft.version,
    );
    assert.equal(f.puts, 1);
    assert.equal(saved.title, draft.title);
    assert.deepEqual(saved.applicability, ["production"]);
    assert.equal(f.instance.domain.composerDrafts(OWNER).length, 0);
    assert.ok(
      !execFileSync("git", ["-C", join(f.dir, "repo"), "ls-files"], {
        encoding: "utf8",
      }).includes(record.id),
    );
  } finally {
    await f.close();
  }
});
test("migration keeps the identity and history, leaves Confluence untouched and survives disconnect", async () => {
  const f = fixture();
  try {
    const record = await f.connect();
    const preview = f.instance.confluence.previewMigration(record.id);
    assert.equal(preview.canMove, true);
    const migrated = await f.instance.confluence.migrate(
      record.id,
      preview.revision,
    );
    assert.equal(migrated.id, record.id);
    assert.equal(
      (migrated.extensions["titan:confluence"] as any).owner,
      "titan",
    );
    assert.equal(f.puts, 0);
    assert.match(
      readFileSync(join(f.dir, "repo", "records", record.id + ".md"), "utf8"),
      /Company guidance/,
    );
    assert.ok(
      f.instance.domain
        .history(OWNER, record.id)
        .some((r) => r.revision === record.revision),
    );
    f.instance.confluence.disconnect();
    assert.equal(f.instance.domain.get(OWNER, record.id).id, record.id);
  } finally {
    await f.close();
  }
});
test("rate limiting backs off and hostile pagination never receives credentials", async () => {
  const f = fixture();
  try {
    await f.connect();
    f.failure = 429;
    await f.sync();
    const status = f.instance.confluence.status();
    assert.ok(Date.parse(status.nextSync!) > Date.now());
    const calls = f.calls.length;
    await f.instance.confluence.tick();
    assert.equal(f.calls.length, calls);
    f.failure = 0;
    f.next = "https://attacker.example/pages";
    await f.sync();
    (f.instance.domain.storage as ConnectedStorage).setState("config", {
      ...(f.instance.domain.storage as ConnectedStorage).state<any>("config"),
      nextAt: 0,
    });
    await f.instance.confluence.tick();
    assert.ok(!f.calls.some((url) => url.includes("attacker.example")));
    assert.ok(f.instance.confluence.status().error);
  } finally {
    await f.close();
  }
});

test("private connection state survives restart and token refresh is serialized", async () => {
  const f = fixture();
  try {
    const record = await f.connect();
    await f.restart();
    assert.equal(
      f.instance.domain.get(OWNER, record.id).revision,
      record.revision,
    );
    assert.equal(f.instance.confluence.status().connected, true);
    const connection = f.instance.confluence as any;
    connection.storeTokens({ ...connection.tokens(), expires: 0 });
    await Promise.all([
      f.instance.confluence.sites(),
      f.instance.confluence.sites(),
    ]);
    assert.equal(f.refreshed, 1);
    const state = new URL(f.instance.confluence.begin().url).searchParams.get(
      "state",
    )!;
    (f.instance.domain.storage as ConnectedStorage).setState("oauth", {
      state,
      expires: 0,
    });
    await assert.rejects(
      f.instance.confluence.callback(state, "code"),
      /expired/,
    );
  } finally {
    await f.close();
  }
});
test("unsupported source content cannot be overwritten or migrated and its original stays private", async () => {
  const f = fixture();
  try {
    f.page = {
      ...f.page,
      body: {
        storage: {
          value:
            '<ac:structured-macro ac:name="include"><ac:parameter ac:name="">Secret source</ac:parameter></ac:structured-macro>',
        },
      },
    };
    const record = await f.connect(true);
    assert.equal(
      f.instance.confluence.previewMigration(record.id).canMove,
      false,
    );
    await assert.rejects(
      f.instance.confluence.migrate(record.id, record.revision),
      /unsupported/,
    );
    const draft = f.instance.domain.saveComposerDraft(OWNER, uid(), 0, {
      kind: record.kind,
      title: record.title,
      body: "Replace macro",
      applicability: [],
      source: { id: record.id, revision: record.revision },
    });
    await assert.rejects(
      f.instance.confluence.publishDraft(draft.id, draft.version),
      /formatting/,
    );
    assert.equal(f.puts, 0);
    assert.equal(
      f.instance.domain.reliability(OWNER, record.id).state,
      "needs_review",
    );
    const context = f.instance.domain
      .context(OWNER, "macro")
      .find((r) => r.id === record.id);
    assert.equal(context?.usableAsBasis, false);
    assert.match(
      (f.instance.domain.storage as ConnectedStorage).state<any>(
        "raw:" + record.id,
      ).body,
      /Secret source/,
    );
  } finally {
    await f.close();
  }
});
test("ownership transfer preserves current connections and recovers a crash after the Git write", async () => {
  const f = fixture();
  try {
    const record = await f.connect();
    const evidence = f.instance.domain.create(OWNER, {
      kind: "evidence",
      title: "Source check",
      body: "Verified basis",
      validity: "supported",
      authority: "observed",
    }) as any;
    const relation = f.instance.domain.relate(OWNER, {
      source: evidence.id,
      target: record.id,
      type: "supports",
      evidence: [],
      revisions: {
        [record.id]: record.revision,
        [evidence.id]: evidence.revision,
      },
      justification: "Checked source supports this guidance",
    });
    const storage = f.instance.domain.storage as ConnectedStorage;
    storage.migrate = (unit) => {
      storage.git.transaction(
        [{ path: `records/${unit.id}.md`, content: encode(unit) }],
        "Simulated interrupted migration",
      );
      throw new Error("Process stopped after Git commit");
    };
    await assert.rejects(
      f.instance.confluence.migrate(record.id, record.revision),
    );
    await f.restart();
    const migrated = f.instance.domain.get(OWNER, record.id);
    assert.equal(
      (migrated.extensions["titan:confluence"] as any).owner,
      "titan",
    );
    assert.equal(
      f.instance.domain.assertions(OWNER).find((a) => a.id === relation.id)
        ?.revisions[record.id],
      migrated.revision,
    );
    assert.equal(
      f.instance.domain.reliability(OWNER, record.id).state,
      "supported",
    );
    f.page = {
      ...f.page,
      title: "Changed original",
      version: { ...f.page.version, number: 2 },
    };
    await f.sync();
    assert.equal(f.instance.domain.get(OWNER, record.id).title, record.title);
    assert.equal(
      f.instance.confluence.sourceStatus(record.id).latestObservedVersion,
      2,
    );
  } finally {
    await f.close();
  }
});

test("metadata scans fetch bodies only for new or changed source versions", async () => {
  const f = fixture();
  try {
    f.metadataOnly = true;
    const record = await f.connect();
    const bodyCalls = () =>
      f.calls.filter((url) => url.includes("/pages/12?body-format=storage"))
        .length;
    assert.equal(bodyCalls(), 1);
    await f.sync();
    assert.equal(bodyCalls(), 1);
    assert.equal(
      f.instance.domain.get(OWNER, record.id).revision,
      record.revision,
    );
    f.page = {
      ...f.page,
      version: { ...f.page.version, number: 2 },
      body: { storage: { value: "<p>Updated source.</p>" } },
    };
    await f.sync();
    assert.equal(bodyCalls(), 2);
    assert.equal(
      f.instance.domain.get(OWNER, record.id).body,
      "Updated source.",
    );
  } finally {
    await f.close();
  }
});

test("Confluence hyperlinks propose revision-pinned connections without establishing support", async () => {
  const f = fixture();
  try {
    const source = await f.connect();
    const target = f.instance.domain.create(OWNER, {
      kind: "knowledge",
      title: "Related guidance",
      body: "Another page.",
    });
    assert.ok("id" in target);
    const links = normalizeConfluence(
      '<p><a href="/wiki/spaces/TEAM/pages/13">Related</a></p>',
      "https://company.atlassian.net",
    ).links;
    assert.deepEqual(links, [
      "https://company.atlassian.net/wiki/spaces/TEAM/pages/13",
    ]);
    const pairs = [{ source: source.id, target: target.id }];
    f.instance.domain.proposeConnectedLinks(pairs);
    f.instance.domain.proposeConnectedLinks(pairs);
    const assertions = f.instance.domain
      .assertions(OWNER)
      .filter((a) => a.source === source.id && a.target === target.id);
    assert.equal(assertions.length, 1);
    assert.equal(assertions[0].state, "proposed");
    assert.equal(assertions[0].type, "relates");
    assert.equal(assertions[0].revisions[source.id], source.revision);
    assert.equal(
      f.instance.domain.get(OWNER, target.id).validity,
      "unverified",
    );
    assert.equal(
      execFileSync("git", ["log", "-p"], {
        cwd: join(f.dir, "repo"),
        encoding: "utf8",
      }).includes("The Confluence page links"),
      false,
    );
  } finally {
    await f.close();
  }
});
