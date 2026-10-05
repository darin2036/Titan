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
import { Intelligence } from "./intelligence.ts";
import {
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
}) {
  const app = Fastify({ logger: false, bodyLimit: 2_000_000 });
  let domain: Domain;
  let intelligence: Intelligence;
  const open = (root: string) => {
    const storage = new GitStorage(root);
    const state = join(options.stateDir, hash(storage.root).slice(0, 20));
    const next = new Domain(storage, new Index(join(state, "index.sqlite")));
    domain = next;
    intelligence = new Intelligence(next, state, options.intelligenceUrl);
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
    if (req.url === "/health" || !req.url.startsWith("/api/")) return;
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
  app.get("/api/v1/workspace", (req) => {
    human(p(req));
    return {
      root: domain!.storage.root,
      settings: domain!.settings(),
      issues: domain!.issues,
      jobs: domain!.index.jobs(),
      credentials: {
        openai: !!process.env.OPENAI_API_KEY,
        anthropic: !!process.env.ANTHROPIC_API_KEY,
      },
      models: domain!.objects("models"),
    };
  });
  app.post("/api/v1/workspace", async (req) => {
    human(p(req));
    demand(
      !intelligence!.busy,
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
    const previous = domain!;
    open(root);
    previous.index.close();
    return { root: domain!.storage.root };
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
  app.get("/api/v1/units/:id", (req) =>
    domain!.get(
      p(req),
      (req.params as any).id,
      (req.query as any).removed === "true",
    ),
  );
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
    const result = await intelligence!.author({ ...b, record });
    if (record)
      demand(
        domain!.get(p(req), record.id).revision === record.revision,
        409,
        "Record changed during authoring",
      );
    return {
      draft: result,
      source: record ? { id: record.id, revision: record.revision } : null,
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
        }, 750);
  timer?.unref();
  app.addHook("onClose", async () => {
    if (timer) clearInterval(timer);
    while (intelligence!.busy)
      await new Promise((resolve) => setTimeout(resolve, 20));
    domain!.index.close();
  });
  return {
    app,
    get domain() {
      return domain!;
    },
    get intelligence() {
      return intelligence!;
    },
  };
}
