import { Domain, OWNER } from "./domain.ts";
import type { RecordView } from "./contracts.ts";
export function seedDemo(domain: Domain) {
  if (domain.records(OWNER).length) return;
  domain.create(OWNER, {
    kind: "knowledge",
    title: "How Titan keeps knowledge trustworthy",
    body: "## Shared memory\n\nKnowledge is connected to the work and evidence that establish it. Age alone does not determine validity.\n\n## Operating principles\n\n- Agents maintain connections; people resolve consequential decisions.\n- Superseded guidance remains available as history.\n- Removed records are excluded from agent context.\n- Every interpretation has inspectable provenance.",
    status: "accepted",
    validity: "supported",
    authority: "approved",
  });
  const old = domain.create(OWNER, {
    kind: "decision",
    title: "Authentication for production services",
    body: "## Decision\n\nProduction services authenticate using long-lived API keys.\n\n## Scope\n\nThis is the original architecture decision, preserved for historical questions.",
    status: "accepted",
    validity: "supported",
    authority: "approved",
    applicability: ["production"],
  }) as RecordView;
  const work = domain.create(OWNER, {
    kind: "work",
    title: "Migrate services to workload identity",
    body: `## Intent\n\nReplace long-lived production API keys with workload identity.\n\nImplements: ${old.id}\n\n## Acceptance criteria\n\n- Verify service authentication.\n- Record migration checks and obtain review.`,
    status: "implemented",
    validity: "unverified",
    authority: "hypothesis",
    applicability: ["production"],
  }) as RecordView;
  const evidence = domain.create(OWNER, {
    kind: "evidence",
    title: "Workload identity migration checks",
    body: `## Observed result\n\nFixture: migration checks passed for production services. This is demonstration evidence.\n\nSupports: ${work.id}`,
    status: "accepted",
    validity: "supported",
    authority: "observed",
    applicability: ["production"],
  }) as RecordView;
  domain.relate(OWNER, {
    source: evidence.id,
    target: work.id,
    type: "supports",
    justification: "Demonstration evidence verifies the migration work.",
    evidence: [evidence.id],
    revisions: { [evidence.id]: evidence.revision, [work.id]: work.revision },
  });
  const current = domain.create(OWNER, {
    kind: "decision",
    title: "Use workload identity in production",
    body: `## Decision\n\nProduction services use short-lived workload identity. Local development may still use API keys.\n\nSupersedes: ${old.id}\n\n## Basis\n\nVerified migration checks establish the production change.\n\nSupports: ${work.id}`,
    status: "accepted",
    validity: "supported",
    authority: "approved",
    applicability: ["production"],
  }) as RecordView;
  domain.relate(
    { id: "fixture-agent", role: "agent", scopes: ["read", "write"] },
    {
      source: current.id,
      target: old.id,
      type: "supersedes",
      justification:
        "The new production decision replaces API keys with workload identity; local development remains outside this scope.",
      evidence: [evidence.id],
      revisions: {
        [current.id]: current.revision,
        [old.id]: old.revision,
        [evidence.id]: evidence.revision,
      },
    },
  );
}
