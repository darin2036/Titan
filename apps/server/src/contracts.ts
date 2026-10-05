import { z } from "zod";
import { createHash, randomUUID } from "node:crypto";
export const id = z.string().uuid();
export const short = z.string().max(600);
export const ConfluenceSourceSchema = z
  .object({
    siteId: z.string().min(1).max(200),
    pageId: z.string().regex(/^\d+$/),
    spaceId: z.string().regex(/^\d+$/),
    parentId: z.string().nullable(),
    url: z
      .string()
      .url()
      .max(2000)
      .refine((value) => new URL(value).protocol === "https:"),
    version: z.number().int().positive(),
    authorId: z.string().nullable(),
    owner: z.enum(["confluence", "titan"]),
    issues: z.array(z.string().max(200)).max(50),
  })
  .strict();
export const UnitSchema = z
  .object({
    schemaVersion: z.literal(1),
    id,
    kind: z.enum(["knowledge", "decision", "work", "evidence"]),
    title: z.string().min(1).max(200),
    body: z.string().max(100_000),
    lifecycle: z.enum(["active", "removed"]).default("active"),
    status: z
      .enum([
        "draft",
        "accepted",
        "ready",
        "in_progress",
        "implemented",
        "completed",
      ])
      .default("draft"),
    validity: z
      .enum(["supported", "unverified", "disputed", "superseded"])
      .default("unverified"),
    authority: z
      .enum(["hypothesis", "observed", "approved"])
      .default("hypothesis"),
    applicability: z.array(z.string().max(120)).max(30).default([]),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    extensions: z
      .record(z.string().regex(/^[a-z][\w-]*:[\w.-]+$/), z.unknown())
      .refine(
        (extensions) =>
          extensions["titan:confluence"] === undefined ||
          ConfluenceSourceSchema.safeParse(extensions["titan:confluence"])
            .success,
        "Invalid Confluence source metadata",
      )
      .default({}),
  })
  .strict();
export type Unit = z.infer<typeof UnitSchema>;
export type RecordView = Unit & { revision: string };
export const ComposerContentSchema = z
  .object({
    kind: UnitSchema.shape.kind,
    title: z.string().max(200),
    body: UnitSchema.shape.body,
    applicability: UnitSchema.shape.applicability,
    source: z
      .object({ id, revision: z.string().min(1) })
      .strict()
      .nullable(),
  })
  .strict();
export type ComposerDraft = z.infer<typeof ComposerContentSchema> & {
  id: string;
  version: number;
  updatedAt: string;
};
export const RelationTypes = [
  { key: "contains", outward: "contains", inward: "is part of" },
  { key: "blocks", outward: "blocks", inward: "is blocked by" },
  { key: "implements", outward: "implements", inward: "is implemented by" },
  { key: "supports", outward: "supports", inward: "is supported by" },
  { key: "contradicts", outward: "contradicts", inward: "is contradicted by" },
  { key: "supersedes", outward: "supersedes", inward: "is superseded by" },
  { key: "relates", outward: "relates to", inward: "relates to" },
];
export const AssertionSchema = z
  .object({
    schemaVersion: z.literal(1),
    id,
    source: id,
    target: id,
    type: z.string().min(1).max(80),
    state: z.enum(["proposed", "accepted", "rejected", "superseded"]),
    justification: short,
    evidence: z.array(id).max(30),
    revisions: z.record(id, z.string()),
    activity: id,
    createdAt: z.string().datetime(),
  })
  .strict();
export type Assertion = z.infer<typeof AssertionSchema>;
export type Principal = {
  id: string;
  role: "human" | "agent";
  scopes: string[];
};
export type Event = {
  schemaVersion: 1;
  id: string;
  activity: string;
  actor: Principal;
  operation: string;
  entities: string[];
  revisions: Record<string, string>;
  resultingRevisions?: Record<string, string>;
  justification: string;
  outcome: string;
  at: string;
  model?: string;
  policyVersion?: string;
};
export const ProviderBaseUrlSchema = z
  .string()
  .trim()
  .max(2000)
  .default("")
  .refine((value) => {
    if (!value) return true;
    try {
      const url = new URL(value);
      return (
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash &&
        (url.protocol === "https:" ||
          (url.protocol === "http:" &&
            ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))
      );
    } catch {
      return false;
    }
  }, "Use an HTTPS API base URL, or HTTP on localhost, without credentials or query parameters");
export const SettingsSchema = z
  .object({
    schemaVersion: z.literal(1),
    deploymentId: id,
    autonomy: z.enum(["bounded", "full"]),
    provider: z.enum(["fixture", "openai", "anthropic", "custom"]),
    model: z.string().max(120),
    credentialRef: z.enum([
      "OPENAI_API_KEY",
      "ANTHROPIC_API_KEY",
      "CUSTOM_API_KEY",
    ]),
    providerBaseUrl: ProviderBaseUrlSchema,
    embeddingModel: z.string().max(120).default(""),
    activeModel: z.string(),
    previousModel: z.string().nullable(),
    webhookUrl: z.string().max(2000).default(""),
    relationshipTypes: z
      .array(
        z.object({
          key: z.string().regex(/^[a-z][\w-]*$/),
          outward: z.string(),
          inward: z.string(),
        }),
      )
      .max(50),
  })
  .strict();
export type Settings = z.infer<typeof SettingsSchema>;
export const InferenceResultSchema = z
  .object({
    version: z.literal(1),
    model: z.string().max(120),
    policyVersion: z.string().max(120),
    proposals: z
      .array(
        z
          .object({
            source: id,
            target: id,
            type: z.string(),
            justification: short,
            evidence: z.array(id).max(30),
          })
          .strict(),
      )
      .max(30),
  })
  .strict();
export const FeedbackSchema = z
  .object({
    type: z.enum([
      "accepted_proposal",
      "rejected_proposal",
      "human_correction",
      "retrieval",
      "verified_outcome",
      "reported_outcome",
    ]),
    label: z.string().max(120),
    entities: z.array(id).min(1).max(30),
    justification: short,
  })
  .strict();
export const uid = () => randomUUID();
export const now = () => new Date().toISOString();
export const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export class Fault extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function demand(
  ok: unknown,
  status: number,
  message: string,
): asserts ok {
  if (!ok) throw new Fault(status, message);
}
export function authorize(p: Principal, scope: string) {
  demand(
    p.scopes.includes("*") || p.scopes.includes(scope),
    403,
    `Missing scope: ${scope}`,
  );
}
export function human(p: Principal) {
  demand(p.role === "human", 403, "This operation requires the human owner");
}
