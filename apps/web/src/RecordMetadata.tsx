import React, { useRef, useState } from "react";
import {
  recordPresentation,
  type RecordSignal,
  type RevisionEvent,
} from "./record-presentation";
import {
  assessReliability,
  type ReliabilityRecord,
  type ReliabilityRelationship,
} from "../../shared/reliability";
export default function RecordMetadata({
  record,
  events,
  records,
  relationships,
  openRecord,
  prepareReview,
}: {
  record: RecordSignal & ReliabilityRecord & { status: string };
  events: RevisionEvent[];
  records: ReliabilityRecord[];
  relationships: ReliabilityRelationship[];
  openRecord: (id: string) => void;
  prepareReview: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [context, setContext] = useState("");
  const signal = recordPresentation(record, events);
  const assessment = assessReliability(
    record,
    records,
    relationships,
    context ? [context] : [],
  );
  const contexts = [
    ...new Set(
      records
        .filter((r) => r.lifecycle === "active")
        .flatMap((r) => r.applicability),
    ),
  ].sort();
  return (
    <>
      <div className="record-metadata" aria-label="Record metadata">
        <span>{signal.type}</span>
        <span>
          {signal.editor ? `Updated by ${signal.editor} · ` : "Updated "}
          <time
            dateTime={record.updatedAt}
            title={new Date(record.updatedAt).toLocaleString()}
          >
            {new Date(record.updatedAt).toLocaleString(undefined, {
              month: "short",
              day: "numeric",
              year: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}
          </time>
        </span>
        <button
          type="button"
          className={"record-signal badge reliability-" + assessment.state}
          aria-haspopup="dialog"
          aria-label={assessment.label + " · Record management"}
          onClick={() => dialog.current?.showModal()}
        >
          {assessment.label}
          <span aria-hidden="true"> ›</span>
        </button>
      </div>
      <dialog
        ref={dialog}
        className="record-management"
        aria-labelledby="record-management-title"
        onClick={(event) => {
          if (event.target === event.currentTarget) dialog.current?.close();
        }}
      >
        <header className="record-management-header">
          <h2 id="record-management-title">Record management</h2>
          <button
            type="button"
            autoFocus
            aria-label="Close record management"
            onClick={() => dialog.current?.close()}
          >
            ×
          </button>
        </header>
        <p className="record-management-title">{record.title}</p>
        <section className="record-review-summary">
          <h3>{assessment.label}</h3>
          <p>{assessment.reasons.join(" ")}</p>
          <p>
            {assessment.state === "supported"
              ? "Inspect the evidence below to understand what supports this page."
              : assessment.state === "superseded"
                ? "Open the replacement below and use its guidance."
                : "Check the evidence below. Ask the agent to prepare any missing support or changes for your review."}
          </p>
          {assessment.state !== "supported" && (
            <button
              type="button"
              onClick={() => {
                dialog.current?.close();
                prepareReview();
              }}
            >
              Prepare review with agent
            </button>
          )}
        </section>
        <section className="record-management-details">
          <h3>Record details</h3>
          <dl>
            <div>
              <dt>Validity</dt>
              <dd>{signal.validity.label}</dd>
            </div>
            <div>
              <dt>Authority</dt>
              <dd>{record.authority}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>{record.status.replaceAll("_", " ")}</dd>
            </div>
            <div>
              <dt>Applies to</dt>
              <dd>{record.applicability.join(", ") || "No scope limits"}</dd>
            </div>
            <div>
              <dt>Revision</dt>
              <dd>
                <code>{record.revision.slice(0, 7)}</code>
              </dd>
            </div>
          </dl>
        </section>
        <div className="reliability-basis" aria-label="Reliability basis">
          <h3>Evidence and basis</h3>
          {contexts.length > 0 &&
            (record.applicability.length > 0 ||
              assessment.basis.length > 0) && (
              <label>
                Context
                <select
                  value={context}
                  onChange={(event) => setContext(event.target.value)}
                >
                  <option value="">Choose a context</option>
                  {contexts.map((scope) => (
                    <option key={scope} value={scope}>
                      {scope}
                    </option>
                  ))}
                </select>
              </label>
            )}
          <p className="hint">
            Basis for revision <code>{assessment.revision.slice(0, 7)}</code>
          </p>
          {assessment.basis.length > 0 ? (
            <ul>
              {assessment.basis.map((basis) => (
                <li key={basis.id}>
                  <strong>
                    {basis.type === "supports"
                      ? "Supporting evidence"
                      : basis.type === "supersedes"
                        ? "Replacement"
                        : "Conflicting evidence"}
                  </strong>
                  <span className="basis-state">
                    {basis.state === "proposed"
                      ? "Proposed"
                      : !basis.current
                        ? "Earlier basis · needs review"
                        : basis.usable
                          ? "Accepted · current basis"
                          : "Accepted · support needs review"}
                  </span>
                  <p>{basis.justification}</p>
                  {basis.records.map((source) => (
                    <div className="basis-source" key={source.id}>
                      <button
                        disabled={!source.available}
                        onClick={() => openRecord(source.id)}
                      >
                        {source.title}
                      </button>
                      <span>
                        Assessed revision{" "}
                        {source.revision?.slice(0, 7) ?? "unrecorded"}
                      </span>
                    </div>
                  ))}
                </li>
              ))}
            </ul>
          ) : (
            <p>
              No supporting connections have been recorded for this revision.
            </p>
          )}
        </div>
      </dialog>
    </>
  );
}
