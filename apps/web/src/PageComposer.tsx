import EditorShortcuts from "./EditorShortcuts";
import React, {
  lazy,
  Suspense,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import PageActionMenu from "./PageActionMenu";
import { recordTypeLabels } from "./record-presentation";
import Markdown from "./record-markdown";
const RichTextEditor = lazy(() => import("./RichTextEditor"));

// Keep draft state and workspace navigation mounted if the lazy editor fails
// to load (for example, a stale development module or deployment chunk).
class EditorBoundary extends React.Component<
  { children: React.ReactNode; fallback: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export type PageDraft = {
  id: string;
  version: number;
  kind: string;
  title: string;
  body: string;
  applicability: string[];
  source: { id: string; revision: string } | null;
  updatedAt: string;
};
export type ComposerHandle = {
  save: () => Promise<PageDraft>;
  isWorking: () => boolean;
};
type Props = {
  initial: PageDraft;
  actionsHost: HTMLElement | null;
  publishLabel?: string;
  publishDisabledReason?: string;
  onAskAgent: () => void;
  api: (path: string, method?: string, body?: unknown) => Promise<any>;
  onSaved: (draft: PageDraft) => void;
  onPublished: (unit: any) => Promise<void>;
  onClose: () => void;
  onDiscard: (id: string) => void;
  ref: React.Ref<ComposerHandle>;
};
const contentOf = ({
  kind,
  title,
  body,
  applicability,
  source,
}: PageDraft) => ({ kind, title, body, applicability, source });
const templates = {
  announcement: {
    title: "Team announcement",
    body: "## What’s happening\n\n\n\n## Who this applies to\n\n\n\n## Next steps\n\n",
  },
  calendar: {
    title: "Company calendar",
    body: "## Office closures and important dates\n\n| Date | Event | Applies to |\n| --- | --- | --- |\n| YYYY-MM-DD | Add an event | Add a team or location |\n\n## Notes\n\n",
  },
  guide: {
    title: "Team guide",
    body: "## Purpose\n\n\n\n## Steps\n\n1. \n\n## Related guidance\n\n",
  },
};
export default function PageComposer({
  initial,
  actionsHost,
  publishLabel,
  publishDisabledReason,
  onAskAgent,
  api,
  onSaved,
  onPublished,
  onClose,
  onDiscard,
  ref,
}: Props) {
  const [value, setValue] = useState(initial);
  const [scopeText, setScopeText] = useState(initial.applicability.join(", "));
  const [status, setStatus] = useState(
    initial.version ? "Draft saved" : "Saving draft…",
  );
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [publishedComparison, setPublishedComparison] = useState<{
    title: string;
    body: string;
    revision: string;
  } | null>(null);
  const latest = useRef(value);
  const saved = useRef(initial);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const mounted = useRef(true);
  const actionInProgress = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  function update(patch: Partial<PageDraft>) {
    const next = { ...latest.current, ...patch };
    latest.current = next;
    setValue(next);
    setStatus("Unsaved changes");
    setConfirmDiscard(false);
  }
  function save(): Promise<PageDraft> {
    const operation = queue.current
      .catch(() => {})
      .then(async () => {
        const content = contentOf(latest.current);
        if (
          saved.current.version &&
          JSON.stringify(content) === JSON.stringify(contentOf(saved.current))
        )
          return saved.current;
        if (mounted.current) setStatus("Saving draft…");
        try {
          const next: PageDraft = await api(
            "/composer-drafts/" + initial.id,
            "PUT",
            { version: saved.current.version, content },
          );
          saved.current = next;
          onSaved(next);
          if (mounted.current) {
            setStatus(
              JSON.stringify(contentOf(latest.current)) ===
                JSON.stringify(content)
                ? "Draft saved"
                : "Unsaved changes",
            );
            setError("");
          }
          return next;
        } catch (e) {
          if (mounted.current) {
            setStatus("Draft couldn’t be saved");
            setError(
              e instanceof Error
                ? e.message
                : "Titan couldn’t save your draft. Try again.",
            );
          }
          throw e;
        }
      });
    queue.current = operation;
    return operation.then((next) => {
      if (
        JSON.stringify(contentOf(latest.current)) !==
        JSON.stringify(contentOf(saved.current))
      )
        return save();
      return next;
    });
  }
  useImperativeHandle(ref, () => ({
    save,
    isWorking: () => actionInProgress.current,
  }));
  useEffect(() => {
    if (working) return;
    const timer = setTimeout(() => {
      void save().catch(() => {});
    }, 700);
    return () => clearTimeout(timer);
  }, [value, working]);
  useEffect(() => {
    function protect(event: BeforeUnloadEvent) {
      if (
        !saved.current.version ||
        JSON.stringify(contentOf(latest.current)) !==
          JSON.stringify(contentOf(saved.current))
      ) {
        event.preventDefault();
      }
    }
    window.addEventListener("beforeunload", protect);
    return () => window.removeEventListener("beforeunload", protect);
  }, []);
  useEffect(() => {
    if (confirmDiscard)
      document.getElementById("confirm-page-discard")?.focus();
  }, [confirmDiscard]);
  async function action(fn: () => Promise<void>) {
    if (actionInProgress.current) return;
    actionInProgress.current = true;
    setWorking(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Titan couldn’t finish this action. Your draft has been kept.",
      );
    } finally {
      actionInProgress.current = false;
      if (mounted.current) setWorking(false);
    }
  }
  return (
    <div className="page-composer">
      {publishDisabledReason && (
        <p className="hint" role="status">
          {publishDisabledReason}
        </p>
      )}
      {actionsHost &&
        createPortal(
          <div className="button-row composer-actions">
            <button
              className="primary"
              disabled={
                working || !value.body.trim() || !!publishDisabledReason
              }
              title={publishDisabledReason}
              onClick={() =>
                void action(async () => {
                  if (!latest.current.title.trim())
                    update({ title: "Untitled" });
                  const draft = await save();
                  const unit = await api(
                    "/composer-drafts/" + draft.id + "/publish",
                    "POST",
                    { version: draft.version },
                  );
                  await onPublished(unit);
                })
              }
            >
              {working
                ? "Working…"
                : initial.source
                  ? (publishLabel ?? "Publish changes")
                  : "Publish page"}
            </button>
            <button
              disabled={working}
              onClick={() =>
                void action(async () => {
                  await save();
                  onClose();
                })
              }
            >
              <span aria-hidden="true">Close</span>
              <span className="sr-only">Save and close</span>
            </button>
            <PageActionMenu>
              {" "}
              {!initial.source && !value.title.trim() && !value.body.trim() && (
                <details className="composer-templates">
                  <summary>Templates</summary>
                  <div
                    className="template-choices"
                    aria-label="Starting points"
                  >
                    {Object.entries(templates).map(([key, template]) => (
                      <button
                        type="button"
                        disabled={working}
                        key={key}
                        onClick={() => update(template)}
                      >
                        {key === "calendar"
                          ? "Company calendar"
                          : key === "guide"
                            ? "Guide"
                            : "Announcement"}
                      </button>
                    ))}
                  </div>
                </details>
              )}
              <button disabled={working} onClick={onAskAgent}>
                Ask agent
              </button>
              <button
                disabled={working}
                onClick={() => setConfirmDiscard(!confirmDiscard)}
              >
                Discard draft
              </button>
              {value.source && (
                <button
                  disabled={working}
                  onClick={() =>
                    void action(async () => {
                      await save();
                      setPublishedComparison(
                        await api("/units/" + value.source!.id),
                      );
                    })
                  }
                >
                  Compare latest page
                </button>
              )}
            </PageActionMenu>
          </div>,
          actionsHost,
        )}
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      {confirmDiscard && (
        <div className="notice">
          <p>
            Discard this draft?{" "}
            {initial.source
              ? "The published page will stay as it is."
              : "Its unpublished content will be removed."}
          </p>
          <div className="button-row">
            <button
              id="confirm-page-discard"
              disabled={working}
              onClick={() =>
                void action(async () => {
                  await queue.current.catch(() => {});
                  if (saved.current.version)
                    await api("/composer-drafts/" + initial.id, "DELETE", {
                      version: saved.current.version,
                    });
                  onDiscard(initial.id);
                })
              }
            >
              Confirm discard
            </button>
            <button disabled={working} onClick={() => setConfirmDiscard(false)}>
              Keep writing
            </button>
          </div>
        </div>
      )}
      <fieldset disabled={working} className="composer-fields">
        <label htmlFor="page-title" className="sr-only">
          Page title
        </label>
        <input
          id="page-title"
          autoFocus
          maxLength={200}
          value={value.title}
          onChange={(e) => update({ title: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              document.getElementById("page-body")?.focus();
            }
          }}
          aria-label="Page title"
          placeholder="Untitled"
        />
        <div className="record-metadata" aria-label="Draft metadata">
          <span>{recordTypeLabels[value.kind] ?? value.kind}</span>
          <span className="badge">Unpublished</span>
          <span role="status">{status}</span>
        </div>
        <label htmlFor="page-body" className="sr-only">
          Page content
        </label>
        <EditorBoundary
          fallback={
            <div className="editor-recovery">
              <div className="notice">
                <p role="alert">
                  Titan couldn’t open the editor. You can keep writing in
                  Markdown, or save and reload to try again.
                </p>
                <button
                  type="button"
                  disabled={working}
                  onClick={() =>
                    void action(async () => {
                      await save();
                      window.location.reload();
                    })
                  }
                >
                  Save and reload
                </button>
              </div>
              <textarea
                id="page-body"
                aria-label="Page content"
                value={value.body}
                rows={12}
                placeholder="Write here…"
                onChange={(event) => update({ body: event.target.value })}
              />
            </div>
          }
        >
          <Suspense fallback={<p className="hint">Opening editor…</p>}>
            <RichTextEditor
              value={value.body}
              disabled={working}
              onChange={(body) => update({ body })}
            />
          </Suspense>
        </EditorBoundary>
        <div className="composer-metadata">
          <details className="composer-details">
            <summary>
              Page details
              <span className="composer-scope-summary">
                {value.applicability.length
                  ? value.applicability.join(", ")
                  : "No scope limits"}
              </span>
            </summary>
            <div className="composer-scope-field">
              <label htmlFor="page-scope">
                Applies to <span className="hint">Optional</span>
              </label>
              <input
                id="page-scope"
                value={scopeText}
                onChange={(e) => {
                  setScopeText(e.target.value);
                  update({
                    applicability: [
                      ...new Set(
                        e.target.value
                          .split(",")
                          .map((s) => s.trim())
                          .filter(Boolean),
                      ),
                    ],
                  });
                }}
                aria-describedby="page-scope-help"
                placeholder="For example: US employees, operations"
              />
              <p className="hint" id="page-scope-help">
                Add teams or locations, separated by commas.
              </p>
            </div>
          </details>
          <EditorShortcuts />
        </div>
      </fieldset>
      {publishedComparison && (
        <div className="document-section">
          <details open>
            <summary>
              Latest published page · {publishedComparison.title}
            </summary>
            <article className="markdown">
              <Markdown>{publishedComparison.body}</Markdown>
            </article>
          </details>
          {publishedComparison.revision !== value.source?.revision && (
            <>
              <p className="hint">
                Review the latest page and copy any changes you need into your
                draft. Continuing keeps your draft’s title, content, and scope;
                publishing will replace those fields in this version.
              </p>
              <button
                disabled={working}
                onClick={() =>
                  void action(async () => {
                    const draft = await save();
                    const next: PageDraft = await api(
                      "/composer-drafts/" + draft.id + "/rebase",
                      "POST",
                      {
                        version: draft.version,
                        revision: publishedComparison.revision,
                      },
                    );
                    saved.current = next;
                    latest.current = next;
                    setValue(next);
                    onSaved(next);
                    setStatus("Draft saved");
                    setPublishedComparison(null);
                  })
                }
              >
                Continue with my draft against this version
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
