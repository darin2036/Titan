import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
const url = process.env.TITAN_API_URL ?? "http://127.0.0.1:4310";
const token = process.env.TITAN_AGENT_TOKEN;
if (!token)
  throw new Error(
    "TITAN_AGENT_TOKEN is required; create a scoped integration token in Titan settings",
  );
const server = new McpServer({ name: "titan", version: "0.1.0" });
async function call(path: string, method = "GET", body?: unknown) {
  const res = await fetch(url + "/api/v1" + path, {
    method,
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const value = await res.json();
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
    isError: !res.ok,
  };
}
server.registerTool(
  "search_context",
  {
    description:
      "Retrieve applicable knowledge and work with revisions, provenance relationships, and validity warnings. Removed records are excluded.",
    inputSchema: { query: z.string(), scope: z.array(z.string()).optional() },
  },
  (args) => call("/context", "POST", args),
);
server.registerTool(
  "read_unit",
  {
    description: "Read a current active knowledge or work record.",
    inputSchema: { id: z.string().uuid() },
  },
  (args) => call("/units/" + args.id),
);
server.registerTool(
  "create_unit",
  {
    description:
      "Author a work, knowledge, decision, or evidence unit. Consequential changes may require owner review.",
    inputSchema: {
      kind: z.enum(["knowledge", "work", "decision", "evidence"]),
      title: z.string(),
      body: z.string(),
      applicability: z.array(z.string()).optional(),
    },
  },
  (args) => call("/units", "POST", args),
);
server.registerTool(
  "revise_unit",
  {
    description:
      "Revise a record using its exact current revision. May create a review proposal.",
    inputSchema: {
      id: z.string().uuid(),
      revision: z.string(),
      patch: z.object({
        title: z.string().optional(),
        body: z.string().optional(),
        status: z
          .enum([
            "draft",
            "accepted",
            "ready",
            "in_progress",
            "implemented",
            "completed",
          ])
          .optional(),
        validity: z
          .enum(["supported", "unverified", "disputed", "superseded"])
          .optional(),
        authority: z.enum(["hypothesis", "observed", "approved"]).optional(),
      }),
      justification: z.string().max(600),
    },
  },
  ({ id, ...args }) => call("/units/" + id, "PATCH", args),
);
server.registerTool(
  "establish_relationship",
  {
    description:
      "Establish an evidenced relationship using revisions for every source, target, and evidence unit.",
    inputSchema: {
      source: z.string().uuid(),
      target: z.string().uuid(),
      type: z.string(),
      evidence: z.array(z.string().uuid()),
      justification: z.string().max(600),
      revisions: z.record(z.string(), z.string()),
    },
  },
  (args) => call("/relationships", "POST", args),
);
server.registerTool(
  "remove_unit",
  {
    description:
      "Soft-remove a record from agent consideration. Only the owner can restore it. No purge exists.",
    inputSchema: {
      id: z.string().uuid(),
      revision: z.string(),
      justification: z.string().min(1).max(600),
    },
  },
  ({ id, ...args }) => call("/units/" + id + "/remove", "POST", args),
);
server.registerTool(
  "record_outcome",
  {
    description:
      "Record external work evidence idempotently. A reported check does not itself establish completion.",
    inputSchema: {
      eventId: z.string().uuid(),
      workId: z.string().uuid(),
      revision: z.string(),
      title: z.string(),
      body: z.string(),
      verified: z.boolean().optional(),
    },
  },
  (args) => call("/outcomes", "POST", args),
);
server.registerTool(
  "record_feedback",
  {
    description:
      "Record retrieval feedback or an observed outcome for deployment-local evaluation.",
    inputSchema: {
      type: z.enum(["retrieval", "reported_outcome"]),
      label: z.string(),
      entities: z.array(z.string().uuid()),
      justification: z.string().max(600),
    },
  },
  (args) => call("/feedback", "POST", args),
);
await server.connect(new StdioServerTransport());
