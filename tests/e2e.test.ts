import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createApp } from "../apps/server/src/api.ts";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { OWNER, INFERENCE } from "../apps/server/src/domain.ts";
import type { RecordView } from "../apps/server/src/contracts.ts";
test("real Python + HTTP + MCP: author, infer, review, retrieve, evaluate, remove", async () => {
  const socket = createServer();
  socket.listen(0, "127.0.0.1");
  await once(socket, "listening");
  const port = (socket.address() as { port: number }).port;
  await new Promise<void>((resolve) => socket.close(() => resolve()));
  const previous = process.env.TITAN_INTELLIGENCE_TOKEN;
  process.env.TITAN_INTELLIGENCE_TOKEN = "test-intelligence-token";
  const python = spawn(
    process.env.PYTHON ?? "python3",
    ["services/intelligence/service.py"],
    {
      env: { ...process.env, TITAN_INTELLIGENCE_PORT: String(port) },
      stdio: "pipe",
    },
  );
  const dir = mkdtempSync(join(tmpdir(), "titan-e2e-"));
  const t = createApp({
    workspace: join(dir, "repo"),
    stateDir: join(dir, "state"),
    ownerToken: "test-owner",
    workers: false,
    intelligenceUrl: `http://127.0.0.1:${port}`,
  });
  let client: Client | undefined;
  try {
    let ready = false;
    for (let i = 0; i < 40; i++) {
      try {
        ready = (await fetch(`http://127.0.0.1:${port}/health`)).ok;
        if (ready) break;
      } catch {}
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.ok(ready, "Python service started");
    const headers = { authorization: "Bearer test-owner" };
    const draft = await t.app.inject({
      method: "POST",
      url: "/api/v1/author",
      headers,
      payload: {
        instruction: "Use API keys for production authentication",
        kind: "decision",
      },
    });
    assert.equal(draft.statusCode, 200);
    const authoredDraft = draft.json().draft;
    assert.equal(authoredDraft.kind, "decision");
    const old = t.domain.create(OWNER, {
      kind: "decision",
      title: "API key authentication",
      body: "Use API keys for production authentication.",
      status: "accepted",
      authority: "approved",
      validity: "supported",
      applicability: ["production"],
    }) as RecordView;
    const replacement = t.domain.create(OWNER, {
      kind: "decision",
      title: "Workload identity authentication",
      body: `Use short-lived workload identity in production.\n\nSupersedes: ${old.id}`,
      status: "accepted",
      authority: "approved",
      validity: "supported",
      applicability: ["production"],
    }) as RecordView;
    await t.intelligence.infer({
      ids: [replacement.id],
      revisions: { [replacement.id]: replacement.revision },
    });
    const proposal = t.domain.reviews(OWNER).relationships[0];
    assert.equal(proposal.type, "supersedes");
    t.domain.review(OWNER, proposal.id, true);
    const context = await t.intelligence.context(
      "authentication",
      ["production"],
      INFERENCE,
    );
    assert.equal(context[0].id, replacement.id);
    assert.equal(context.find((r) => r.id === old.id)?.usableAsBasis, false);
    const authored = await t.intelligence.author({
      instruction: "Use local development credentials only.",
      kind: "decision",
      record: t.domain.get(OWNER, old.id),
      selection: "Use API keys for production authentication.",
    });
    assert.equal(authored.body, "Use local development credentials only.");
    const model = await t.intelligence.evaluate();
    assert.equal(model.evaluation.passed, true);
    t.domain.activate(OWNER, model.id);
    t.domain.rollback(OWNER);
    await t.app.listen({ host: "127.0.0.1", port: 0 });
    const address = t.app.server.address() as { port: number };
    const agentToken = t.domain.index.token(["read", "write"]);
    client = new Client({ name: "titan-test", version: "1" });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [
          resolve("node_modules/tsx/dist/cli.mjs"),
          resolve("apps/server/src/mcp.ts"),
        ],
        env: {
          ...Object.fromEntries(
            Object.entries(process.env).filter(
              (e): e is [string, string] => e[1] !== undefined,
            ),
          ),
          TITAN_API_URL: `http://127.0.0.1:${address.port}`,
          TITAN_AGENT_TOKEN: agentToken,
        },
      }),
    );
    const tools = await client.listTools();
    assert.ok(tools.tools.some((tool) => tool.name === "search_context"));
    const result = await client.callTool({
      name: "search_context",
      arguments: { query: "authentication", scope: ["production"] },
    });
    assert.equal(result.isError, false);
    t.domain.remove(
      INFERENCE,
      old.id,
      t.domain.get(OWNER, old.id).revision,
      "Historical record removed",
    );
    const unavailable = await client.callTool({
      name: "read_unit",
      arguments: { id: old.id },
    });
    assert.equal(unavailable.isError, true);
    assert.ok(!JSON.stringify(unavailable).includes("Use API keys"));
  } finally {
    await client?.close();
    await t.app.close();
    python.kill("SIGTERM");
    if (previous === undefined) delete process.env.TITAN_INTELLIGENCE_TOKEN;
    else process.env.TITAN_INTELLIGENCE_TOKEN = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});
