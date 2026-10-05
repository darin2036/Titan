/** Revision-bound, explainable assessment. Retrieval ranking is not a probability of truth. */
export type ReliabilityRecord = {
  id: string;
  revision: string;
  title: string;
  lifecycle: string;
  validity: string;
  authority: string;
  applicability: string[];
  extensions?: Record<string, unknown>;
};
export type ReliabilityRelationship = {
  id: string;
  source: string;
  target: string;
  type: string;
  state: string;
  justification: string;
  evidence: string[];
  revisions: Record<string, string>;
};
export type ReliabilityState =
  "supported" | "needs_review" | "disputed" | "superseded" | "not_assessed";
const labels: Record<ReliabilityState, string> = {
  supported: "Supported",
  needs_review: "Needs review",
  disputed: "Disputed",
  superseded: "Superseded",
  not_assessed: "Not yet assessed",
};
export function assessReliability(
  record: ReliabilityRecord,
  records: ReliabilityRecord[],
  relationships: ReliabilityRelationship[],
  scope: string[] = [],
) {
  const byId = new Map(records.map((r) => [r.id, r]));
  byId.set(record.id, record);
  const available = (id: string, seen = new Set<string>()): boolean => {
    const r = byId.get(id);
    if (!r || r.lifecycle !== "active" || seen.has(id)) return false;
    const refs = r.extensions?.["titan:sources"];
    if (refs === undefined) return true;
    if (!refs || typeof refs !== "object" || Array.isArray(refs)) return false;
    const visited = new Set([...seen, id]);
    return Object.entries(refs).every(
      ([source, revision]) =>
        typeof revision === "string" &&
        byId.get(source)?.revision === revision &&
        available(source, visited),
    );
  };
  const evidenceUsable = (id: string, seen = new Set<string>()): boolean => {
    const r = byId.get(id);
    if (
      !r ||
      !available(id) ||
      seen.has(id) ||
      r.validity !== "supported" ||
      r.authority === "hypothesis"
    )
      return false;
    if (
      r.applicability.length &&
      (!scope.length || !r.applicability.some((s) => scope.includes(s)))
    )
      return false;
    const source = r.extensions?.["titan:confluence"] as
      { issues?: unknown } | undefined;
    if (Array.isArray(source?.issues) && source.issues.length) return false;
    const incoming = relationships.filter(
      (a) => a.target === id && ["accepted", "proposed"].includes(a.state),
    );
    if (incoming.some((a) => ["contradicts", "supersedes"].includes(a.type)))
      return false;
    const upstream = incoming.filter(
      (a) => a.type === "supports" && a.state === "accepted",
    );
    const visited = new Set([...seen, id]);
    return upstream.every((a) =>
      [...new Set([a.target, a.source, ...a.evidence])].every(
        (ref) =>
          available(ref) &&
          a.revisions[ref] === byId.get(ref)?.revision &&
          (ref === id || evidenceUsable(ref, visited)),
      ),
    );
  };
  // Only incoming support/conflict/replacement relationships assess this claim.
  const basis = relationships
    .filter(
      (a) =>
        a.target === record.id &&
        ["supports", "contradicts", "supersedes"].includes(a.type) &&
        ["accepted", "proposed"].includes(a.state),
    )
    .map((a) => {
      const ids = [...new Set([a.source, a.target, ...a.evidence])];
      const current = ids.every(
        (id) => available(id) && a.revisions[id] === byId.get(id)?.revision,
      );
      const trustworthy = ids
        .filter((id) => id !== record.id)
        .every((id) => evidenceUsable(id));
      return {
        id: a.id,
        type: a.type,
        state: a.state,
        justification: a.justification,
        current,
        usable: a.state === "accepted" && current && trustworthy,
        records: ids
          .filter((id) => id !== record.id)
          .map((id) => ({
            id,
            title: available(id) ? byId.get(id)!.title : "Unavailable record",
            revision: a.revisions[id] ?? null,
            available: available(id),
          })),
      };
    });
  const applicability = !record.applicability.length
    ? "general"
    : !scope.length
      ? "unconfirmed"
      : record.applicability.some((s) => scope.includes(s))
        ? "matches"
        : "outside";
  const source = record.extensions?.["titan:confluence"] as
    { issues?: unknown } | undefined;
  const sourceIncomplete =
    Array.isArray(source?.issues) && source.issues.length > 0;
  const reasons: string[] = [];
  let state: ReliabilityState = "not_assessed";
  if (record.lifecycle !== "active") {
    state = "needs_review";
    reasons.push("This record was removed and is excluded from agent context.");
  } else if (
    record.validity === "superseded" ||
    basis.some((a) => a.type === "supersedes" && a.usable)
  ) {
    state = "superseded";
    reasons.push(
      "This guidance has been replaced. Review its replacement before using it.",
    );
  } else if (
    record.validity === "disputed" ||
    basis.some((a) => a.type === "contradicts" && a.usable)
  ) {
    state = "disputed";
    reasons.push(
      "The recorded validity or accepted evidence identifies a conflict.",
    );
  } else if (sourceIncomplete) {
    state = "needs_review";
    reasons.push(
      "The Confluence source contains content Titan cannot fully represent. Review the original before relying on this view.",
    );
  } else if (
    !available(record.id) ||
    basis.some((a) => a.state === "accepted" && !a.current)
  ) {
    state = "needs_review";
    reasons.push(
      "A record used in the assessment changed or is unavailable. The earlier basis needs review.",
    );
  } else if (
    basis.some((a) => ["contradicts", "supersedes"].includes(a.type))
  ) {
    state = "needs_review";
    reasons.push(
      "A possible conflict or replacement needs review before relying on this record.",
    );
  } else if (basis.some((a) => a.type === "supports" && a.usable)) {
    state = "supported";
    reasons.push(
      "Accepted support refers to current revisions of supported evidence with an observed or approved basis.",
    );
  } else if (
    basis.some(
      (a) => a.type === "supports" && a.state === "accepted" && !a.usable,
    )
  ) {
    state = "needs_review";
    reasons.push(
      "Supporting records need review of their validity, authority, applicability, or upstream evidence.",
    );
  } else if (record.validity === "supported") {
    state = "needs_review";
    reasons.push(
      "Recorded validity is supported, but Titan has no current supporting connection that establishes the basis.",
    );
  } else {
    reasons.push(
      "Titan has not established a current supporting basis for this revision.",
    );
  }
  if (applicability === "unconfirmed" || applicability === "outside") {
    if (state === "supported") state = "needs_review";
    reasons.push(
      applicability === "outside"
        ? "This record's applicability does not match the selected context."
        : "This record has a specific applicability. Choose a context to check whether it applies.",
    );
  }
  return {
    model: "revision-basis-v1",
    recordId: record.id,
    revision: record.revision,
    state,
    label:
      state === "supported" && scope.length
        ? "Supported for this context"
        : labels[state],
    applicability,
    scope,
    reasons,
    basis,
  };
}
export type ReliabilityAssessment = ReturnType<typeof assessReliability>;
