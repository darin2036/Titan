import test from "node:test";
import assert from "node:assert/strict";
import {
  recordPresentation,
  type RevisionEvent,
} from "../apps/web/src/record-presentation";
const record = {
  id: "page",
  revision: "current",
  kind: "knowledge",
  validity: "unverified",
  updatedAt: "2026-10-05T12:00:00Z",
};
const event: RevisionEvent = {
  actor: { id: "owner", role: "human" },
  operation: "edit",
  outcome: "applied",
  at: record.updatedAt,
  revisions: { page: "previous" },
  resultingRevisions: { page: "current" },
};
test("record signal uses actual validity and revision-bound editor attribution", () => {
  const signal = recordPresentation(record, [event]);
  assert.equal(signal.type, "Knowledge");
  assert.equal(signal.validity.label, "Unverified");
  assert.equal(signal.editor, "Owner");
  assert.equal(
    recordPresentation(
      { ...record, kind: "decision", validity: "superseded" },
      [event],
    ).validity.label,
    "Superseded",
  );
  assert.equal(
    recordPresentation(record, [
      { ...event, actor: { id: "titan", role: "agent" } },
    ]).editor,
    "Agent (titan)",
  );
});
test("input revisions, proposals, and external edits never borrow an older editor", () => {
  assert.equal(
    recordPresentation(record, [
      {
        ...event,
        resultingRevisions: undefined,
        revisions: { page: "current" },
      },
    ]).editor,
    null,
  );
  assert.equal(
    recordPresentation(record, [{ ...event, outcome: "proposed" }]).editor,
    null,
  );
  assert.equal(
    recordPresentation({ ...record, revision: "external" }, [event]).editor,
    null,
  );
  assert.equal(
    recordPresentation(record, [
      {
        ...event,
        operation: "create",
        resultingRevisions: undefined,
        revisions: { page: "current" },
      },
    ]).editor,
    "Owner",
  );
});

test("observing a Confluence revision does not attribute source authorship to the importer", () => {
  assert.equal(
    recordPresentation(record, [
      {
        ...event,
        operation: "confluence_observed",
        actor: { id: "confluence", role: "agent" },
      },
    ]).editor,
    null,
  );
  assert.equal(
    recordPresentation(record, [{ ...event, operation: "confluence_write" }])
      .editor,
    "Owner",
  );
});
