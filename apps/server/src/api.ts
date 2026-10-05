import { IntegrationRegistry } from "./integrations.ts";
import { confluenceManifest } from "../../shared/integrations/confluence.ts";
import Fastify from "fastify";
import cors from "@fastify/cors";
import staticPlugin from "@fastify/static";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve, join } from "node:path";
import { timingSafeEqual } from "node:crypto";
import { z, ZodError } from "zod";
import { Domain, OWNER } from "./domain.ts";
import { GitStorage } from "./storage.ts";
import { Index } from "./index.ts";
import { ConnectedStorage } from "./connected-storage.ts";
import { Confluence, type ConfluenceOptions } from "./confluence.ts";
import { Intelligence } from "./intelligence.ts";
import {
  ProviderBaseUrlSchema,
  Fault,
  demand,
  human,
  authorize,
  hash,
  uid,
  type Principal,
} from "./contracts.ts";
import { seedDemo } from "./demo.ts";
const equal = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export function createApp(options: {
  workspace: string;
  stateDir: string;
  ownerToken: string;
  demo?: boolean;
  intelligenceUrl?: string;
  workers?: boolean;
  confluence?: ConfluenceOptions;
}) {
  const app = Fastify({ logger: false, bodyLimit: 2_000_000 });
  let domain: Domain;
  let intelligence: Intelligence;
  let confluence: Confluence;
  let connectedStorage: ConnectedStorage;
  const open = (root: string) => {
    const previousDomain = domain;
    const previousStorage = connectedStorage;
    const git = new GitStorage(root);
    const state = join(options.stateDir, hash(git.root).slice(0, 20));
    const storage = new ConnectedStorage(git, join(state, "connected.sqlite"));
    const next = new Domain(storage, new Index(join(state, "index.sqlite")));
    connectedStorage = storage;
    confluence = new Confluence(
      next,
      storage,
      state,
      options.confluence ?? {
        clientId: process.env.TITAN_CONFLUENCE_CLIENT_ID,
        clientSecret: process.env.TITAN_CONFLUENCE_CLIENT_SECRET,
        redirectUri: process.env.TITAN_CONFLUENCE_REDIRECT_URI,
      },
    );
    domain = next;
    intelligence = new Intelligence(next, state, options.intelligenceUrl);
    previousDomain?.index.close();
    previousStorage?.close();
  };
  open(options.workspace);
  if (options.demo) seedDemo(domain!);
  const origins = new Set([
    process.env.TITAN_WEB_ORIGIN ?? "http://127.0.0.1:5173",
    process.env.TITAN_SERVER_ORIGIN ?? "http://127.0.0.1:4310",
  ]);
  app.register(cors, {
    origin: (origin, cb) => cb(null, !origin || origins.has(origin)),
    credentials: true,
  });
  app.setErrorHandler((error, request, reply) => {
    const status =
      error instanceof Fault
        ? error.status
        : error instanceof ZodError
          ? 422
          : 500;
    reply.status(status).send({
      error:
        error instanceof Fault
          ? error.message
          : error instanceof ZodError
            ? "Invalid request: " +
              error.issues
                .map((i) => i.path.join(".") + ": " + i.message)
                .join("; ")
            : "Operation failed; records are preserved",
    });
  });
  app.addHook("preHandler", async (req) => {
    if (
      req.url === "/health" ||
      req.url.split("?")[0] === "/api/v1/integrations/confluence/callback" ||
      !req.url.startsWith("/api/")
    )
      return;
    const bearer = req.headers.authorization?.replace(/^Bearer /, "");
    const cookie = req.headers.cookie
      ?.split("; ")
      .find((c) => c.startsWith("titan_session="))
      ?.slice(14);
    const token = bearer ?? cookie ?? "";
    const principal = equal(token, options.ownerToken)
      ? OWNER
      : domain!.index.resolveToken(token);
    demand(principal, 401, "Connect with an owner or integration token");
    if (cookie && !bearer && req.method !== "GET")
      demand(
        req.headers.origin && origins.has(req.headers.origin),
        403,
        "Untrusted browser origin",
      );
    (req as any).principal = principal;
  });
  const p = (req: any) => req.principal as Principal;
  app.get("/health", () => ({ ok: true, version: "0.1.0" }));
  app.post("/api/v1/session", (req, reply) => {
    human(p(req));
    reply.header(
      "Set-Cookie",
      `titan_session=${options.ownerToken}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200`,
    );
    return { ok: true };
  });
  app.delete("/api/v1/session", (_req, reply) => {
    reply.header(
      "Set-Cookie",
      "titan_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
    );
    return { ok: true };
  });
  const integrations = new IntegrationRegistry();
  integrations.register({
    manifest: confluenceManifest,
    status: () => ({
      ...confluence!.status(),
      accountLabel: confluence!.status().site?.name,
    }),
    authorize: (values) => confluence!.begin(values.allowEdits === true),
    configure: (values) => confluence!.configure(values),
    sync: () => confluence!.schedule(),
    disconnect: () => confluence!.disconnect(),
    choices: {
      "/sites": () => confluence!.sites(),
      "/spaces": (query) =>
        confluence!.spaces(z.string().min(1).parse(query.siteId)),
    },
  });
  app.get("/api/v1/integrations", (req) => {
    human(p(req));
    return integrations.catalog();
  });
  app.get("/api/v1/integrations/:integrationId/manifest", (req) => {
    human(p(req));
    const manifest = integrations.manifest((req.params as any).integrationId);
    demand(manifest, 404, "This integration isn’t available.");
    return manifest;
  });
  const integrationId = (req: any) => String(req.params.integrationId);
  app.get("/api/v1/integrations/:integrationId", (req) => {
    human(p(req));
    return integrations.get(integrationId(req)).status();
  });
  app.post("/api/v1/integrations/:integrationId/authorize", (req) => {
    human(p(req));
    return integrations.authorize(integrationId(req), req.body);
  });
  app.put("/api/v1/integrations/:integrationId", (req) => {
    human(p(req));
    return integrations.configure(integrationId(req), req.body);
  });
  app.post("/api/v1/integrations/:integrationId/sync", (req) => {
    human(p(req));
    const plugin = integrations.get(integrationId(req));
    demand(plugin.sync, 422, "This integration doesn’t support syncing.");
    return plugin.sync();
  });
  app.delete("/api/v1/integrations/:integrationId", (req) => {
    human(p(req));
    return integrations.get(integrationId(req)).disconnect();
  });
  app.get("/api/v1/integrations/:integrationId/:source", (req) => {
    human(p(req));
    return integrations.choices(
      integrationId(req),
      (req.params as any).source,
      z.record(z.string(), z.string()).parse(req.query),
    );
  });
  const connection = "/api/v1/integrations/confluence";
  app.get(connection + "/callback", async (req, reply) => {
    const query = z
      .object({
        state: z.string().min(1),
        code: z.string().optional(),
        error: z.string().optional(),
      })
      .parse(req.query);
    try {
      await confluence!.callback(query.state, query.code, !!query.error);
    } catch {
      return reply.redirect(
        (process.env.TITAN_WEB_ORIGIN ?? "http://127.0.0.1:5173") +
          "/?confluence=error",
      );
    }
    return reply.redirect(
      (process.env.TITAN_WEB_ORIGIN ?? "http://127.0.0.1:5173") +
        "/?confluence=connected",
    );
  });
  app.post("/api/v1/units/:id/confluence/refresh", async (req) => {
    human(p(req));
    return confluence!.refreshPage(
      z
        .string()
        .uuid()
        .parse((req.params as any).id),
    );
  });
  app.get("/api/v1/units/:id/confluence/source", (req) => {
    human(p(req));
    return confluence!.sourceStatus(
      z
        .string()
        .uuid()
        .parse((req.params as any).id),
    );
  });
  app.get("/api/v1/units/:id/confluence/migration", (req) => {
    human(p(req));
    return confluence!.previewMigration(
      z
        .string()
        .uuid()
        .parse((req.params as any).id),
    );
  });
  app.post("/api/v1/units/:id/confluence/migration", async (req) => {
    human(p(req));
    return confluence!.migrate(
      z
        .string()
        .uuid()
        .parse((req.params as any).id),
      z
        .object({ revision: z.string().min(1) })
        .strict()
        .parse(req.body).revision,
    );
  });
  app.get("/api/v1/workspace", (req) => {
    human(p(req));
    return {
      root: domain!.storage.root,
      confluence: confluence!.status(),
      settings: domain!.settings(),
      issues: domain!.issues,
      jobs: domain!.index.jobs(),
      credentials: intelligence!.credentialStatus(),
      models: domain!.objects("models"),
    };
  });
  app.post("/api/v1/workspace", async (req) => {
    human(p(req));
    demand(
      !intelligence!.busy && !confluence!.busy,
      409,
      "Wait for the active background operation before switching workspaces",
    );
    const input = z
      .object({
        path: z.string().min(1).optional(),
        github: z.string().optional(),
      })
      .strict()
      .parse(req.body);
    let root = input.path ? resolve(input.path) : "";
    if (input.github) {
      demand(
        /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?\/?$/.test(
          input.github,
        ),
        422,
        "Provide an HTTPS GitHub repository URL without credentials",
      );
      root = join(options.stateDir, "clones", hash(input.github).slice(0, 20));
      if (!existsSync(root))
        execFileSync("git", ["clone", "--", input.github, root], {
          stdio: "pipe",
          timeout: 60000,
        });
    }
    demand(root, 422, "Provide a local path or GitHub URL");
    open(root);
    return { root: domain!.storage.root };
  });
  app.put("/api/v1/intelligence/credentials", (req) => {
    human(p(req));
    const input = z
      .object({
        provider: z.enum(["openai", "anthropic", "custom"]),
        apiKey: z
          .string()
          .trim()
          .max(1000)
          .refine(
            (key) => !/\s/.test(key),
            "API key cannot contain whitespace",
          ),
      })
      .strict()
      .parse(req.body);
    return intelligence!.saveCredential(input.provider, input.apiKey);
  });
  app.post("/api/v1/intelligence/test", async (req) => {
    human(p(req));
    const input = z
      .object({
        provider: z.enum(["openai", "anthropic", "custom"]),
        model: z.string().trim().min(1).max(120),
        providerBaseUrl: ProviderBaseUrlSchema,
      })
      .strict()
      .parse(req.body);
    return intelligence!.testConnection({
      ...input,
      credentialRef:
        input.provider === "openai"
          ? "OPENAI_API_KEY"
          : input.provider === "anthropic"
            ? "ANTHROPIC_API_KEY"
            : "CUSTOM_API_KEY",
    });
  });
  app.patch("/api/v1/settings", (req) =>
    domain!.updateSettings(p(req), req.body),
  );
  app.post("/api/v1/publish", (req) => {
    human(p(req));
    return { branch: domain!.storage.sync() };
  });
  app.post("/api/v1/reindex", (req) => {
    human(p(req));
    domain!.reconcile();
    return { issues: domain!.issues };
  });
  app.get("/api/v1/units", (req) =>
    domain!.records(p(req), (req.query as any).removed === "true"),
  );
  app.post("/api/v1/units", (req) => domain!.create(p(req), req.body));
  app.get("/api/v1/places", (req) => domain!.places(p(req)));
  app.post("/api/v1/places", (req) => domain!.savePlace(p(req), req.body));
  app.put("/api/v1/places/:id", (req) => {
    const body = z
      .object({ revision: z.string().min(1), content: z.unknown() })
      .strict()
      .parse(req.body);
    return domain!.savePlace(
      p(req),
      body.content,
      (req.params as any).id,
      body.revision,
    );
  });
  app.get("/api/v1/composer-drafts", (req) => domain!.composerDrafts(p(req)));
  app.put("/api/v1/composer-drafts/:id", (req) => {
    const body = z
      .object({ version: z.number().int().nonnegative(), content: z.unknown() })
      .strict()
      .parse(req.body);
    return domain!.saveComposerDraft(
      p(req),
      (req.params as any).id,
      body.version,
      body.content,
    );
  });
  app.post("/api/v1/composer-drafts/:id/publish", async (req) => {
    const body = z
      .object({ version: z.number().int().positive() })
      .strict()
      .parse(req.body);
    const draft = domain!
      .composerDrafts(p(req))
      .find((d) => d.id === (req.params as any).id);
    const record = draft?.source
      ? domain!.get(p(req), draft.source.id)
      : undefined;
    if ((record?.extensions["titan:confluence"] as any)?.owner === "confluence")
      return confluence!.publishDraft((req.params as any).id, body.version);
    return domain!.publishComposerDraft(
      p(req),
      (req.params as any).id,
      body.version,
    );
  });
  app.post("/api/v1/composer-drafts/:id/rebase", (req) => {
    const body = z
      .object({
        version: z.number().int().positive(),
        revision: z.string().min(1),
      })
      .strict()
      .parse(req.body);
    return domain!.rebaseComposerDraft(
      p(req),
      (req.params as any).id,
      body.version,
      body.revision,
    );
  });
  app.delete("/api/v1/composer-drafts/:id", (req) => {
    const body = z
      .object({ version: z.number().int().positive() })
      .strict()
      .parse(req.body);
    return domain!.discardComposerDraft(
      p(req),
      (req.params as any).id,
      body.version,
    );
  });
  app.get("/api/v1/units/:id", (req) =>
    domain!.get(
      p(req),
      (req.params as any).id,
      (req.query as any).removed === "true",
    ),
  );
  app.get("/api/v1/units/:id/reliability", (req) => {
    const query = z
      .object({ scope: z.string().max(120).optional() })
      .strict()
      .parse(req.query);
    return domain!.reliability(
      p(req),
      (req.params as any).id,
      query.scope ? [query.scope] : [],
    );
  });
  app.patch("/api/v1/units/:id", (req) => {
    const body = z
      .object({
        revision: z.string(),
        patch: z.unknown(),
        justification: z.string().max(600).default("Record revised"),
      })
      .strict()
      .parse(req.body);
    return domain!.edit(
      p(req),
      (req.params as any).id,
      body.revision,
      body.patch,
      body.justification,
    );
  });
  app.post("/api/v1/units/:id/remove", (req) => {
    const b = z
      .object({
        revision: z.string(),
        justification: z.string().min(1).max(600),
      })
      .strict()
      .parse(req.body);
    return domain!.remove(
      p(req),
      (req.params as any).id,
      b.revision,
      b.justification,
    );
  });
  app.post("/api/v1/units/:id/restore", (req) =>
    domain!.restore(
      p(req),
      (req.params as any).id,
      z.object({ revision: z.string() }).parse(req.body).revision,
    ),
  );
  app.get("/api/v1/units/:id/history", (req) =>
    domain!.history(p(req), (req.params as any).id),
  );
  app.get("/api/v1/relationships", (req) => domain!.assertions(p(req)));
  app.post("/api/v1/relationships", (req) => domain!.relate(p(req), req.body));
  app.get("/api/v1/reviews", (req) => domain!.reviews(p(req)));
  app.post("/api/v1/reviews/:id", (req) => {
    domain!.review(
      p(req),
      (req.params as any).id,
      z.object({ accept: z.boolean() }).parse(req.body).accept,
    );
    return { ok: true };
  });
  app.get("/api/v1/audit", (req) => domain!.audit(p(req)));
  app.post("/api/v1/feedback", (req) => domain!.feedback(p(req), req.body));
  app.post("/api/v1/context", async (req) => {
    const b = z
      .object({
        query: z.string().max(1000),
        scope: z.array(z.string()).default([]),
      })
      .strict()
      .parse(req.body);
    return intelligence!.context(b.query, b.scope, p(req));
  });
  app.post("/api/v1/author", async (req) => {
    authorize(p(req), "write");
    const b = z
      .object({
        instruction: z.string().min(1).max(12000),
        kind: z
          .enum(["knowledge", "decision", "work", "evidence"])
          .default("knowledge"),
        id: z.string().uuid().optional(),
        revision: z.string().optional(),
        selection: z.string().max(12000).optional(),
        placeId: z.string().uuid().optional(),
      })
      .strict()
      .parse(req.body);
    const record = b.id ? domain!.get(p(req), b.id) : undefined;
    if (record)
      demand(
        record.revision === b.revision,
        409,
        "Record changed; refresh before authoring",
      );
    if (record && /^remove this record$/i.test(b.instruction.trim()))
      return {
        draft: {
          title: record.title,
          body: record.body,
          kind: record.kind,
          justification: "Owner requested removal through the agent workspace",
          operation: "remove",
        },
        source: { id: record.id, revision: record.revision },
      };
    const statusMatch = b.instruction.match(
      /^mark (?:this )?(?:work )?(ready|in progress|implemented|completed|accepted)$/i,
    );
    if (record && statusMatch)
      return {
        draft: {
          title: record.title,
          body: record.body,
          kind: record.kind,
          justification:
            "Owner requested a work transition through the agent workspace",
          operation: "status",
          patch: { status: statusMatch[1].toLowerCase().replace(" ", "_") },
        },
        source: { id: record.id, revision: record.revision },
      };
    const place = b.placeId
      ? domain!.places(p(req)).find((place) => place.id === b.placeId)
      : undefined;
    if (b.placeId) demand(place, 404, "This place is unavailable");
    const sources =
      place && !record
        ? domain!.records(p(req)).filter((u) => place.memberIds.includes(u.id))
        : [];
    demand(
      sources.reduce((total, u) => total + u.body.length, 0) <= 100_000,
      422,
      "This place has too much content for one draft. Choose a smaller set of records.",
    );
    const sourceRevisions = Object.fromEntries(
      sources.map((u) => [u.id, u.revision]),
    );
    const result = await intelligence!.author({ ...b, record, sources });
    for (const [id, revision] of Object.entries(sourceRevisions))
      demand(
        domain!.get(p(req), id).revision === revision,
        409,
        "A source changed during authoring. Prepare a fresh draft.",
      );
    if (record)
      demand(
        domain!.get(p(req), record.id).revision === record.revision,
        409,
        "Record changed during authoring",
      );
    return {
      draft: result,
      source: record ? { id: record.id, revision: record.revision } : null,
      ...(sources.length
        ? { sources: sourceRevisions, placeId: place!.id }
        : {}),
    };
  });
  app.post("/api/v1/tokens", (req) => {
    human(p(req));
    const scopes = z
      .object({ scopes: z.array(z.enum(["read", "write"])).min(1) })
      .strict()
      .parse(req.body).scopes;
    return { token: domain!.index.token(scopes), scopes };
  });
  app.post("/api/v1/outcomes", (req) => domain!.outcome(p(req), req.body));
  app.post("/api/v1/datasets", (req) => domain!.dataset(p(req)));
  app.post("/api/v1/models/evaluate", async (req) => {
    human(p(req));
    return intelligence!.evaluate();
  });
  app.post("/api/v1/models/:id/activate", (req) => {
    domain!.activate(p(req), (req.params as any).id);
    return { ok: true };
  });
  app.post("/api/v1/models/rollback", (req) => {
    domain!.rollback(p(req));
    return { ok: true };
  });
  const dist = resolve("apps/web/dist");
  if (existsSync(dist)) app.register(staticPlugin, { root: dist });
  app.setNotFoundHandler((req, reply) => {
    if (!req.url.startsWith("/api/") && existsSync(dist))
      return reply.sendFile("index.html");
    return reply.status(404).send({ error: "Not found" });
  });
  const timer =
    options.workers === false
      ? undefined
      : setInterval(() => {
          void intelligence!.tick().catch(() => {});
          void confluence!.tick().catch(() => {});
        }, 750);
  timer?.unref();
  app.addHook("onClose", async () => {
    if (timer) clearInterval(timer);
    while (intelligence!.busy || confluence!.busy)
      await new Promise((resolve) => setTimeout(resolve, 20));
    domain!.index.close();
    connectedStorage!.close();
  });
  return {
    app,
    get domain() {
      return domain!;
    },
    get confluence() {
      return confluence!;
    },
    get intelligence() {
      return intelligence!;
    },
  };
}
