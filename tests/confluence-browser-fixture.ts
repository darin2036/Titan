// Disposable, offline Atlassian simulator for reviewing the real Settings and page UI.
// Run: npx tsx tests/confluence-browser-fixture.ts
import { createApp } from "../apps/server/src/api.ts";
import { OWNER } from "../apps/server/src/domain.ts";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
const dir = mkdtempSync(join(tmpdir(), "titan-confluence-ui-"));
const origin = "http://127.0.0.1:4320";
process.env.TITAN_WEB_ORIGIN = origin;
process.env.TITAN_SERVER_ORIGIN = origin;
const token = randomBytes(32).toString("hex");
const pages = [
  {
    id: "12",
    spaceId: "7",
    status: "current",
    title: "Team deployment guide",
    createdAt: "2026-10-05T12:00:00Z",
    version: {
      number: 1,
      createdAt: "2026-10-05T12:00:00Z",
      authorId: "qa-source-author",
    },
    body: {
      storage: {
        value:
          "<h2>Deploy with a basis</h2><p>Use workload identity for production services. Review the deployment checks before publishing a change.</p><table><tbody><tr><th>Stage</th><th>Check</th></tr><tr><td>Preview</td><td>Smoke tests passed</td></tr><tr><td>Production</td><td>Owner approved</td></tr></tbody></table>",
      },
    },
    _links: { webui: "/wiki/spaces/TEAM/pages/12" },
  },
  {
    id: "13",
    spaceId: "7",
    status: "current",
    title: "Operational dashboard",
    createdAt: "2026-10-05T12:00:00Z",
    version: {
      number: 1,
      createdAt: "2026-10-05T12:00:00Z",
      authorId: "qa-source-author",
    },
    body: {
      storage: {
        value:
          '<p>Production monitoring.</p><ac:structured-macro ac:name="chart"><ac:parameter ac:name="title">Production health</ac:parameter></ac:structured-macro>',
      },
    },
    _links: { webui: "/wiki/spaces/TEAM/pages/13" },
  },
];
const request: typeof fetch = async (input, init) => {
  const url = String(input);
  const response = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  if (url === "https://auth.atlassian.com/oauth/token")
    return response({
      access_token: "qa-access",
      refresh_token: "qa-refresh",
      expires_in: 3600,
      scope:
        "offline_access read:page:confluence read:space:confluence write:page:confluence",
    });
  if (url.endsWith("accessible-resources"))
    return response([
      {
        id: "cloud",
        name: "Titan QA",
        url: "https://titan-qa.atlassian.net",
        scopes: [
          "read:page:confluence",
          "read:space:confluence",
          "write:page:confluence",
        ],
      },
    ]);
  if (!url.startsWith("https://api.atlassian.com/ex/confluence/cloud/wiki/"))
    throw new Error("Unexpected simulator request");
  if (url.includes("/spaces?"))
    return response({
      results: [{ id: "7", name: "Team knowledge", key: "TEAM" }],
    });
  const match = url.match(/\/pages\/(\d+)/);
  if (match) {
    const page = pages.find((p) => p.id === match[1]);
    if (!page) return response({}, 404);
    if (init?.method === "PUT") {
      const value = JSON.parse(String(init.body));
      if (value.version.number !== page.version.number + 1)
        return response({}, 409);
      page.title = value.title;
      page.body.storage.value = value.body.value;
      page.version.number = value.version.number;
    }
    return response(page);
  }
  if (url.includes("/pages?")) return response({ results: pages });
  throw new Error("Unexpected simulator endpoint");
};
const instance = createApp({
  workspace: join(dir, "repo"),
  stateDir: join(dir, "state"),
  ownerToken: token,
  workers: false,
  confluence: {
    clientId: "qa-app",
    clientSecret: "qa-secret",
    redirectUri: origin + "/api/v1/integrations/confluence/callback",
    fetch: request,
  },
});
const state = new URL(instance.confluence.begin(false).url).searchParams.get(
  "state",
)!;
await instance.confluence.callback(state, "qa-code");
const artifacts = resolve(".local");
mkdirSync(artifacts, { recursive: true, mode: 0o700 });
const authPath = join(artifacts, "confluence-ui-state.json");
writeFileSync(
  authPath,
  JSON.stringify({
    cookies: [
      {
        name: "titan_session",
        value: token,
        domain: "127.0.0.1",
        path: "/",
        expires: -1,
        httpOnly: true,
        secure: false,
        sameSite: "Strict",
      },
    ],
    origins: [],
  }),
  { mode: 0o600 },
);
let seeded = false;
const timer = setInterval(() => {
  void (async () => {
    await instance.confluence.tick();
    const record = instance.domain
      .records(OWNER)
      .find((r) => r.title === "Team deployment guide");
    if (record && !seeded) {
      seeded = true;
      const evidence = instance.domain.create(OWNER, {
        kind: "evidence",
        title: "Deployment smoke test",
        body: "The simulated deployment passed its identity checks.",
        validity: "supported",
        authority: "observed",
      }) as any;
      instance.domain.relate(OWNER, {
        source: evidence.id,
        target: record.id,
        type: "supports",
        evidence: [],
        revisions: {
          [record.id]: record.revision,
          [evidence.id]: evidence.revision,
        },
        justification:
          "The deployment checks support the guide’s current revision.",
      });
    }
  })().catch(() => {});
}, 750);
await instance.app.listen({ host: "127.0.0.1", port: 4320 });
console.log("Offline Confluence UI fixture ready at " + origin);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    clearInterval(timer);
    void instance.app.close().then(() => {
      rmSync(authPath, { force: true });
      rmSync(dir, { recursive: true, force: true });
      process.exit(0);
    });
  });
