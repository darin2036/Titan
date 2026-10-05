export type RecordSignal = {
  id: string;
  revision: string;
  kind: string;
  validity: string;
  updatedAt: string;
};
export type RevisionEvent = {
  actor: { id: string; role: string };
  operation: string;
  outcome: string;
  at: string;
  revisions: Record<string, string>;
  resultingRevisions?: Record<string, string>;
};
export const recordTypeLabels: Record<string, string> = {
  knowledge: "Knowledge",
  work: "Work",
  decision: "Decision",
  evidence: "Evidence",
};
const validitySignals: Record<string, { label: string; description: string }> =
  {
    supported: {
      label: "Supported",
      description:
        "Titan records this as supported. Review its evidence and connections for the basis.",
    },
    unverified: {
      label: "Unverified",
      description: "Support has not been established for this record.",
    },
    disputed: {
      label: "Disputed",
      description:
        "Evidence conflicts. Review the record before relying on it.",
    },
    superseded: {
      label: "Superseded",
      description: "This record has been replaced. Review the newer guidance.",
    },
  };
export function recordPresentation(
  record: RecordSignal,
  events: RevisionEvent[],
) {
  // Edit events historically identify the INPUT revision. Only a resulting
  // revision (or an original create event) can establish the current editor.
  const event = events
    .filter(
      (event) =>
        event.outcome === "applied" &&
        (event.resultingRevisions?.[record.id] === record.revision ||
          (event.operation === "create" &&
            event.revisions[record.id] === record.revision)),
    )
    .sort((a, b) => b.at.localeCompare(a.at))[0];
  const editor =
    event && event.operation !== "confluence_observed"
      ? event.actor.role === "human"
        ? event.actor.id === "owner"
          ? "Owner"
          : event.actor.id
        : `Agent (${event.actor.id})`
      : null;
  return {
    type: recordTypeLabels[record.kind] ?? record.kind,
    validity: validitySignals[record.validity] ?? {
      label: record.validity,
      description: "",
    },
    editor,
  };
}
