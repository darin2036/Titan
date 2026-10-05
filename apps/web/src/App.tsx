import React, { useState, useEffect, useCallback, useRef } from "react";
import Markdown from "react-markdown";
import FloatingAgent from "./FloatingAgent";
type Unit = {
  id: string;
  kind: string;
  title: string;
  body: string;
  revision: string;
  lifecycle: string;
  status: string;
  validity: string;
  authority: string;
  applicability: string[];
  updatedAt: string;
  warnings?: string[];
};
type Relationship = {
  id: string;
  source: string;
  target: string;
  type: string;
  state: string;
  justification: string;
  evidence: string[];
};
type Draft = {
  draft: {
    title: string;
    body: string;
    kind: string;
    justification: string;
    operation?: string;
    patch?: Record<string, string>;
  };
  source: { id: string; revision: string } | null;
};
async function api(
  path: string,
  method = "GET",
  body?: unknown,
  token?: string,
) {
  const res = await fetch("/api/v1" + path, {
    method,
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const value = await res.json();
  if (!res.ok) throw new Error(value.error ?? "Request failed");
  return value;
}
const labels: Record<string, string> = {
  knowledge: "Knowledge",
  decision: "Decisions",
  work: "Work",
  evidence: "Evidence",
  reviews: "Review inbox",
  audit: "Decision log",
  settings: "Settings",
  learning: "Learning",
  removed: "Trash",
};
const symbols: Record<string, string> = {
  knowledge: "◈",
  decision: "◇",
  work: "▤",
  evidence: "✓",
  reviews: "◉",
  audit: "≋",
  settings: "⚙",
  learning: "⌘",
  removed: "⊖",
};
export default function App() {
  const [connected, setConnected] = useState(false),
    [token, setToken] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [view, setView] = useState("knowledge"),
    [units, setUnits] = useState<Unit[]>([]),
    [selected, setSelected] = useState<string | null>(null),
    [workspace, setWorkspace] = useState<any>(null),
    [relations, setRelations] = useState<Relationship[]>([]),
    [reviews, setReviews] = useState<any>({ relationships: [], mutations: [] }),
    [events, setEvents] = useState<any[]>([]),
    [history, setHistory] = useState<Unit[]>([]);
  const [query, setQuery] = useState(""),
    [search, setSearch] = useState<Unit[] | null>(null),
    [instruction, setInstruction] = useState(""),
    [kind, setKind] = useState("knowledge"),
    [draft, setDraft] = useState<Draft | null>(null),
    [selection, setSelection] = useState(""),
    [newUnit, setNewUnit] = useState(false),
    [message, setMessage] = useState(""),
    [localPath, setLocalPath] = useState(""),
    [github, setGithub] = useState(""),
    [integrationToken, setIntegrationToken] = useState("");
  const [agentOpen, setAgentOpen] = useState(false);
  const articleRef = useRef<HTMLElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  function openComposer() {
    setAgentOpen(true);
    requestAnimationFrame(() => composerRef.current?.focus());
  }
  const current = units.find((u) => u.id === selected) ?? null;
  const refresh = useCallback(async () => {
    const [u, w, r, v, e] = await Promise.all([
      api("/units?removed=true"),
      api("/workspace"),
      api("/relationships"),
      api("/reviews"),
      api("/audit"),
    ]);
    setUnits(u);
    setWorkspace(w);
    setRelations(r);
    setReviews(v);
    setEvents(e);
  }, []);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    const initial = location.hash.startsWith("#token=")
      ? decodeURIComponent(location.hash.slice(7))
      : "";
    if (initial) window.history.replaceState(null, "", location.pathname);
    void (async () => {
      try {
        if (initial) await api("/session", "POST", {}, initial);
        await refresh();
        setConnected(true);
      } catch {
        if (initial)
          setError(
            "Connection failed. Paste the owner token from the local state file.",
          );
      }
    })();
  }, [refresh]);
  useEffect(() => {
    if (!connected) return;
    const timer = setInterval(() => {
      void refresh().catch(() => {});
    }, 5000);
    return () => clearInterval(timer);
  }, [connected, refresh]);
  useEffect(() => {
    setHistory([]);
    setSelection("");
    setDraft(null);
    if (current)
      void api("/units/" + current.id + "/history")
        .then(setHistory)
        .catch(() => {});
  }, [selected, current?.revision]);
  useEffect(() => {
    function captureSelection() {
      const range = window.getSelection();
      const article = articleRef.current;
      if (
        article &&
        range &&
        article.contains(range.anchorNode) &&
        article.contains(range.focusNode)
      ) {
        const text = range.toString();
        if (text.trim()) setSelection(text.slice(0, 12000));
      }
    }
    document.addEventListener("selectionchange", captureSelection);
    return () =>
      document.removeEventListener("selectionchange", captureSelection);
  }, []);
  const reviewCount = reviews.relationships.length + reviews.mutations.length;
  const list = (
    search ?? units.filter((u) => u.lifecycle === "active" && u.kind === view)
  ).filter((u) => u.lifecycle === "active");
  async function author() {
    if (!instruction.trim()) return;
    await run(async () => {
      const response = await api("/author", "POST", {
        instruction,
        kind,
        ...(!newUnit && current
          ? { id: current.id, revision: current.revision, selection }
          : {}),
      });
      setDraft(response);
      setMessage(
        "I prepared a change for you to review. Nothing has been applied yet.",
      );
    });
  }
  async function apply() {
    if (!draft) return;
    await run(async () => {
      if (draft.source) {
        if (draft.draft.operation === "remove")
          await api("/units/" + draft.source.id + "/remove", "POST", {
            revision: draft.source.revision,
            justification: draft.draft.justification,
          });
        else
          await api("/units/" + draft.source.id, "PATCH", {
            revision: draft.source.revision,
            patch: draft.draft.patch ?? {
              title: draft.draft.title,
              body: draft.draft.body,
            },
            justification: draft.draft.justification,
          });
      } else {
        const result = await api("/units", "POST", {
          kind: draft.draft.kind,
          title: draft.draft.title,
          body: draft.draft.body,
        });
        if (result.id) {
          setSelected(result.id);
          setView(result.kind);
        }
      }
      setDraft(null);
      setInstruction("");
      setSelection("");
      setNewUnit(false);
      setMessage(
        "Applied. Titan is checking related knowledge and recording the change.",
      );
      await refresh();
    });
  }
  function navigate(next: string) {
    setView(next);
    setSearch(null);
    setQuery("");
    setDraft(null);
    setSelected(null);
    setNewUnit(false);
    if (["knowledge", "work", "decision", "evidence"].includes(next))
      setKind(next);
  }
  if (!connected)
    return (
      <div className="login">
        <div className="login-card">
          <div className="brand-mark">T</div>
          <div className="eyebrow">Your Titan workspace</div>
          <h1>Welcome to Titan</h1>
          <p>
            A home for your ideas, decisions, and next steps. Connect your
            workspace to get started.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await api("/session", "POST", {}, token);
                setToken("");
                await refresh();
                setConnected(true);
              });
            }}
          >
            <label>
              Owner token
              <input
                type="password"
                autoComplete="off"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="From your local Titan launcher"
              />
            </label>
            <button className="primary" disabled={busy}>
              Open workspace →
            </button>
          </form>
          {error && (
            <div className="error" role="alert">
              {error}
            </div>
          )}
          <small>
            Your records stay in your repository. Model connections are
            optional.
          </small>
        </div>
      </div>
    );
  return (
    <div className="shell">
      <aside className="sidebar">
        <a className="brand" href="#" onClick={(e) => e.preventDefault()}>
          <span className="brand-mark">T</span> Titan
        </a>
        <div className="workspace-name">
          <span className="dot" /> Local workspace
          <small>Shared memory for agents</small>
        </div>
        <div className="nav-label">Workspace</div>
        <nav aria-label="Workspace">
          {["knowledge", "work", "decision", "evidence"].map((key) => (
            <button
              key={key}
              className={view === key ? "nav active" : "nav"}
              onClick={() => navigate(key)}
            >
              <span>{symbols[key]}</span>
              {labels[key]}
              <small>
                {
                  units.filter(
                    (u) => u.kind === key && u.lifecycle === "active",
                  ).length
                }
              </small>
            </button>
          ))}
        </nav>
        <div className="nav-label">Manage</div>
        <nav aria-label="Manage workspace">
          {["reviews", "audit", "learning", "removed"].map((key) => (
            <button
              key={key}
              className={view === key ? "nav active" : "nav"}
              onClick={() => navigate(key)}
            >
              <span>{symbols[key]}</span>
              {labels[key]}
              {key === "reviews" && reviewCount > 0 && (
                <small className="notification">{reviewCount}</small>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="agent-health">
            <span className="dot" />
            {workspace?.settings.provider === "fixture"
              ? "Demo workspace"
              : "Agent connected"}
            <small>
              {workspace?.settings.autonomy === "bounded"
                ? "Review important changes"
                : "Automatic changes enabled"}
            </small>
          </div>
          <button
            className={view === "settings" ? "nav active" : "nav"}
            onClick={() => navigate("settings")}
          >
            <span>⚙</span>Settings
          </button>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <div>
            <span className="breadcrumb">Workspace / </span>
            {labels[view]}
          </div>
          <div className="top-actions">
            <span className="local-pill">● Local workspace</span>
            {["knowledge", "work", "decision", "evidence"].includes(view) && (
              <button
                className="agent-toggle"
                aria-expanded={agentOpen}
                aria-controls="workspace-agent"
                onClick={() =>
                  agentOpen ? setAgentOpen(false) : openComposer()
                }
              >
                ✳ {agentOpen ? "Hide agent" : "Ask agent"}
              </button>
            )}
          </div>
        </header>
        {error && (
          <div className="error global" role="alert">
            {error}
            <button onClick={() => setError("")} aria-label="Dismiss error">
              ×
            </button>
          </div>
        )}
        <div className="page-heading">
          <div>
            <h1>{labels[view]}</h1>
            <p>
              {view === "knowledge"
                ? "Keep useful ideas and what you’ve learned in one place."
                : view === "work"
                  ? "Plan your next steps and keep work moving."
                  : view === "reviews"
                    ? "Review suggested changes with the context you need."
                    : view === "learning"
                      ? "Help Titan learn from your feedback."
                      : view === "audit"
                        ? "See what changed and why."
                        : view === "removed"
                          ? "Find removed records and restore them when you need to."
                          : view === "settings"
                            ? "Make Titan work the way you want."
                            : "Keep the reasoning and evidence behind your work close by."}
            </p>
          </div>
          {["knowledge", "work", "decision", "evidence"].includes(view) && (
            <button
              className="primary"
              onClick={() => {
                setNewUnit(true);
                setSelected(null);
                setDraft(null);
                setInstruction("");
                setMessage(
                  "Share what you have in mind. I’ll prepare a draft for you to review.",
                );
                openComposer();
              }}
            >
              ＋ New record
            </button>
          )}
        </div>
        {["knowledge", "work", "decision", "evidence"].includes(view) && (
          <div className="workspace-grid">
            <section className="record-browser">
              <form
                className="search"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(async () => {
                    setSearch(
                      query.trim()
                        ? await api("/context", "POST", { query })
                        : null,
                    );
                  });
                }}
              >
                <span>⌕</span>
                <input
                  aria-label="Search knowledge and work"
                  placeholder="Search records…"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    if (!e.target.value) setSearch(null);
                  }}
                />
                <kbd>↵</kbd>
              </form>
              <div className="section-label">
                {search ? "Search results" : labels[view]}{" "}
                <span>{list.length}</span>
              </div>
              <div className="record-list">
                {list.map((u) => (
                  <button
                    key={u.id}
                    className={
                      "record-card " + (u.id === selected ? "selected" : "")
                    }
                    onClick={() => {
                      setSelected(u.id);
                      setNewUnit(false);
                    }}
                  >
                    <div className="card-meta">
                      <span>
                        {symbols[u.kind]} {u.kind}
                      </span>
                      <span
                        className={"tiny-dot " + u.validity}
                        aria-label={u.validity}
                      />
                    </div>
                    <h3>{u.title}</h3>
                    <p>{u.body.replace(/[#*]/g, "").slice(0, 100)}</p>
                    <div className="card-footer">
                      <span>{u.validity}</span>
                      <span>
                        {new Date(u.updatedAt).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                        })}
                      </span>
                    </div>
                  </button>
                ))}
                {!list.length && (
                  <div className="empty small">
                    <span>◇</span>
                    <h3>Your first record starts here</h3>
                    <p>
                      Choose New record to add an idea, decision, or next step.
                    </p>
                  </div>
                )}
              </div>
            </section>
            <section className="document-panel">
              {current ? (
                <>
                  <div className="document-toolbar">
                    <span className="badge">{current.kind}</span>
                    <span className="revision">
                      Revision {current.revision.slice(0, 7)}
                    </span>
                  </div>
                  <h2>{current.title}</h2>
                  <div className="metadata">
                    <span className={"badge " + current.validity}>
                      {current.validity}
                    </span>
                  </div>
                  <details className="record-details">
                    <summary>Record details</summary>
                    <div className="metadata">
                      <span className="badge">{current.authority}</span>
                      <span className="badge">
                        {current.status.replace("_", " ")}
                      </span>
                      {current.applicability.map((a) => (
                        <span className="scope" key={a}>
                          {a}
                        </span>
                      ))}
                    </div>
                  </details>
                  {["superseded", "disputed"].includes(current.validity) && (
                    <div className="notice">
                      {current.validity === "superseded"
                        ? "This guidance has been replaced. Review the newer version before using it."
                        : "The evidence for this record conflicts. Review it before making a decision."}
                    </div>
                  )}
                  <article className="markdown" ref={articleRef}>
                    <Markdown
                      components={{
                        a: ({ href, children }) => (
                          <a
                            href={href}
                            onClick={(e) => {
                              if (href?.startsWith("#unit-")) {
                                e.preventDefault();
                                const unit = units.find(
                                  (u) => u.id === href.slice(6),
                                );
                                if (unit) {
                                  setSelected(unit.id);
                                  setView(unit.kind);
                                }
                              }
                            }}
                          >
                            {children}
                          </a>
                        ),
                      }}
                    >
                      {current.body.replace(
                        /(Implements|Supports|Supersedes|Contradicts|Blocks|Contains):\s*([0-9a-f-]{36})/gi,
                        (_match, label, id) =>
                          `${label}: [${units.find((u) => u.id === id)?.title ?? "Unavailable record"}](#unit-${id})`,
                      )}
                    </Markdown>
                  </article>
                  <div className="document-section">
                    <div className="section-label">
                      Connections{" "}
                      <span>
                        {
                          relations.filter(
                            (a) =>
                              a.source === current.id ||
                              a.target === current.id,
                          ).length
                        }
                      </span>
                    </div>
                    {relations
                      .filter(
                        (a) =>
                          a.source === current.id || a.target === current.id,
                      )
                      .map((a) => {
                        const other = units.find(
                          (u) =>
                            u.id ===
                            (a.source === current.id ? a.target : a.source),
                        );
                        const type = workspace?.settings.relationshipTypes.find(
                          (t: any) => t.key === a.type,
                        );
                        return (
                          <button
                            className="relationship"
                            key={a.id}
                            onClick={() => {
                              if (other) {
                                setSelected(other.id);
                                setView(other.kind);
                              }
                            }}
                          >
                            <span>
                              {a.source === current.id
                                ? type?.outward
                                : type?.inward}
                            </span>
                            <strong>
                              {other?.title ?? "Unavailable record"}
                            </strong>
                            <small>{a.state}</small>
                          </button>
                        );
                      })}
                    <p className="hint">
                      Titan links related records and keeps the evidence with
                      them.
                    </p>
                  </div>
                  <details className="document-section">
                    <summary>Revision history · {history.length}</summary>
                    {history.map((u, i) => (
                      <div className="history-row" key={u.revision + i}>
                        <code>{u.revision.slice(0, 7)}</code>
                        <span>{new Date(u.updatedAt).toLocaleString()}</span>
                        <span>{u.validity}</span>
                      </div>
                    ))}
                  </details>
                </>
              ) : (
                <div className="empty document-empty">
                  <div className="orb">◈</div>
                  <h2>
                    {newUnit
                      ? "What’s on your mind?"
                      : "Make room for a good idea"}
                  </h2>
                  <p>
                    {newUnit
                      ? "Share your idea with the agent. Titan will turn it into a connected record you can review."
                      : "Open a record to explore it, or start something new with your agent."}
                  </p>
                  <button
                    className="empty-action"
                    onClick={() => {
                      setNewUnit(true);
                      setInstruction("");
                      setMessage(
                        "Share what you have in mind. I’ll prepare a draft for you to review.",
                      );
                      openComposer();
                    }}
                  >
                    {newUnit ? "Share your idea →" : "＋ Create a record"}
                  </button>
                </div>
              )}
            </section>
            <FloatingAgent
              open={agentOpen}
              onOpen={openComposer}
              onClose={() => setAgentOpen(false)}
              selection={!!selection}
              subtitle={
                workspace?.settings.provider === "fixture"
                  ? "Demo · drag to move"
                  : "Drag to move"
              }
            >
              <div className="conversation-content">
                <div className="agent-message">
                  <span className="eyebrow">Let’s think it through</span>
                  <p>
                    {message ||
                      "Share an idea or select some text to improve. I’ll prepare a draft you can review."}
                  </p>
                </div>
                {selection && (
                  <div className="selection" role="status">
                    <div className="selection-heading">
                      <span>Selected passage · added to context</span>
                      <button
                        type="button"
                        aria-label="Clear selected passage"
                        onClick={() => setSelection("")}
                      >
                        ×
                      </button>
                    </div>
                    <p title={selection}>“{selection}”</p>
                  </div>
                )}
                {draft && (
                  <div className="preview">
                    <div className="section-label">Draft for review</div>
                    <h3>{draft.draft.title}</h3>
                    {draft.draft.operation ? (
                      <p>
                        {draft.draft.operation === "remove"
                          ? "Remove from agent consideration"
                          : JSON.stringify(draft.draft.patch)}
                      </p>
                    ) : (
                      <div className="preview-body">
                        <Markdown>{draft.draft.body}</Markdown>
                      </div>
                    )}
                    <p className="hint">{draft.draft.justification}</p>
                    <div className="button-row">
                      <button
                        className="primary"
                        disabled={busy}
                        onClick={() => void apply()}
                      >
                        Apply change
                      </button>
                      <button disabled={busy} onClick={() => setDraft(null)}>
                        Discard
                      </button>
                    </div>
                  </div>
                )}
              </div>
              <form
                className="composer"
                onSubmit={(e) => {
                  e.preventDefault();
                  void author();
                }}
              >
                {newUnit && (
                  <label className="kind-select">
                    Capture as
                    <select
                      value={kind}
                      onChange={(e) => setKind(e.target.value)}
                    >
                      {["knowledge", "work", "decision", "evidence"].map(
                        (k) => (
                          <option key={k} value={k}>
                            {k}
                          </option>
                        ),
                      )}
                    </select>
                  </label>
                )}
                <textarea
                  ref={composerRef}
                  aria-label="Message the workspace agent"
                  placeholder={
                    selection
                      ? "How should this passage change?"
                      : "What’s on your mind?"
                  }
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value)}
                />
                <div className="composer-footer">
                  <small>Review before applying</small>
                  <button
                    className="send"
                    aria-label="Prepare agent draft"
                    disabled={busy || !instruction.trim()}
                  >
                    {busy ? "…" : "↑"}
                  </button>
                </div>
                {current && (
                  <div className="quick-prompts">
                    {current.kind === "work" && (
                      <button
                        type="button"
                        onClick={() => setInstruction("Mark this work ready")}
                      >
                        Mark ready
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setInstruction("Remove this record")}
                    >
                      Remove
                    </button>
                  </div>
                )}
              </form>
            </FloatingAgent>
          </div>
        )}
        {view === "reviews" && (
          <section className="wide-panel">
            {!reviewCount ? (
              <Empty
                title="Nothing waiting on you"
                text="Agents handle routine organization. Consequential changes appear here with their evidence."
              />
            ) : (
              <>
                {reviews.relationships.map((a: Relationship) => (
                  <div className="review-card" key={a.id}>
                    <span className="badge">{a.type}</span>
                    <h2>{units.find((u) => u.id === a.source)?.title}</h2>
                    <p>
                      {a.type} → {units.find((u) => u.id === a.target)?.title}
                    </p>
                    <p>{a.justification}</p>
                    <small>
                      {a.evidence.length} evidence reference(s) · exact source
                      revisions recorded
                    </small>
                    {a.evidence.length > 0 && (
                      <details className="document-section">
                        <summary>View supporting evidence</summary>
                        {a.evidence.map((id) => {
                          const evidence = units.find((unit) => unit.id === id);
                          return evidence ? (
                            <article className="markdown" key={id}>
                              <h3>{evidence.title}</h3>
                              <p className="hint">
                                {evidence.validity} · {evidence.authority} ·
                                revision {evidence.revision.slice(0, 7)}
                              </p>
                              <Markdown>{evidence.body}</Markdown>
                            </article>
                          ) : (
                            <p key={id}>
                              This evidence is unavailable. Reevaluate the
                              proposal before accepting it.
                            </p>
                          );
                        })}
                      </details>
                    )}
                    <div className="button-row">
                      <button
                        className="primary"
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            await api("/reviews/" + a.id, "POST", {
                              accept: true,
                            });
                            await refresh();
                          })
                        }
                      >
                        Accept interpretation
                      </button>
                      <button
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            await api("/reviews/" + a.id, "POST", {
                              accept: false,
                            });
                            await refresh();
                          })
                        }
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                ))}
                {reviews.mutations.map((r: any) => (
                  <div className="review-card" key={r.id}>
                    <h3>{r.action} proposal</h3>
                    <pre>{JSON.stringify(r.value, null, 2)}</pre>
                    <div className="button-row">
                      <button
                        className="primary"
                        onClick={() =>
                          void run(async () => {
                            await api("/reviews/" + r.id, "POST", {
                              accept: true,
                            });
                            await refresh();
                          })
                        }
                      >
                        Accept
                      </button>
                      <button
                        onClick={() =>
                          void run(async () => {
                            await api("/reviews/" + r.id, "POST", {
                              accept: false,
                            });
                            await refresh();
                          })
                        }
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                ))}
              </>
            )}
          </section>
        )}
        {view === "audit" && (
          <section className="wide-panel">
            {events.map((e) => (
              <div className="audit-row" key={e.id}>
                <div className="timeline-dot" />
                <div>
                  <strong>{e.operation.replaceAll("_", " ")}</strong>
                  <p>{e.justification}</p>
                  <small>
                    {e.actor.id} · {e.model ?? "domain engine"} · {e.outcome}
                  </small>
                  <details>
                    <summary>Provenance</summary>
                    <pre>
                      {JSON.stringify(
                        {
                          activity: e.activity,
                          entities: e.entities,
                          revisions: e.revisions,
                          policyVersion: e.policyVersion,
                        },
                        null,
                        2,
                      )}
                    </pre>
                  </details>
                </div>
                <time>{new Date(e.at).toLocaleString()}</time>
              </div>
            ))}
          </section>
        )}
        {view === "removed" && (
          <section className="wide-panel">
            {units
              .filter((u) => u.lifecycle === "removed")
              .map((u) => (
                <div className="review-card" key={u.id}>
                  <span className="badge">Removed</span>
                  <h2>{u.title}</h2>
                  <details>
                    <summary>Inspect retained content</summary>
                    <Markdown>{u.body}</Markdown>
                  </details>
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await api("/units/" + u.id + "/restore", "POST", {
                          revision: u.revision,
                        });
                        await refresh();
                      })
                    }
                  >
                    Restore and reevaluate
                  </button>
                </div>
              ))}
            {!units.some((u) => u.lifecycle === "removed") && (
              <Empty
                title="No removed records"
                text="Removed records will appear here. You can restore them whenever you need to."
              />
            )}
          </section>
        )}
        {view === "settings" && workspace && (
          <section className="settings-grid">
            <div className="wide-panel">
              <h2>Repository</h2>
              <p className="hint">{workspace.root}</p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(async () => {
                    await api("/workspace", "POST", { path: localPath });
                    await refresh();
                    setSelected(null);
                  });
                }}
              >
                <label>
                  Local repository path
                  <input
                    value={localPath}
                    onChange={(e) => setLocalPath(e.target.value)}
                    placeholder="/path/to/your/repository"
                  />
                </label>
                <button disabled={busy || !localPath}>
                  Connect local repository
                </button>
              </form>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(async () => {
                    await api("/workspace", "POST", { github });
                    await refresh();
                  });
                }}
              >
                <label>
                  GitHub repository URL
                  <input
                    value={github}
                    onChange={(e) => setGithub(e.target.value)}
                    placeholder="https://github.com/owner/repository"
                  />
                </label>
                <button disabled={busy || !github}>Connect GitHub</button>
              </form>
              <div className="button-row">
                <button
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const r = await api("/publish", "POST", {});
                      setMessage("Published to " + r.branch);
                      await refresh();
                    })
                  }
                >
                  Publish workspace branch
                </button>
                <button
                  onClick={() =>
                    void run(async () => {
                      await api("/reindex", "POST", {});
                      await refresh();
                    })
                  }
                >
                  Rebuild index
                </button>
              </div>
              {workspace.issues.map((i: any) => (
                <div className="notice" key={i.path}>
                  {i.path}: {i.message}
                </div>
              ))}
            </div>
            <div className="wide-panel">
              <h2>Intelligence & autonomy</h2>
              <SettingsForm
                settings={workspace.settings}
                busy={busy}
                save={(patch) =>
                  run(async () => {
                    await api("/settings", "PATCH", patch);
                    await refresh();
                  })
                }
              />
              <p className="hint">
                API keys are read from server environment variables. OpenAI:{" "}
                {workspace.credentials.openai ? "configured" : "not configured"}{" "}
                · Anthropic:{" "}
                {workspace.credentials.anthropic
                  ? "configured"
                  : "not configured"}
              </p>
              <div className="notice">
                Fixture mode uses explicit references for deterministic
                relationships. Live modes infer relationships from supplied
                context.
              </div>
            </div>
            <div className="wide-panel">
              <h2>Agent access</h2>
              <p>
                Create a read/write token for MCP and external workflows. Save
                it now; it is shown only when created.
              </p>
              <button
                onClick={() =>
                  void run(async () => {
                    setIntegrationToken(
                      (
                        await api("/tokens", "POST", {
                          scopes: ["read", "write"],
                        })
                      ).token,
                    );
                  })
                }
              >
                Create integration token
              </button>
              {integrationToken && (
                <>
                  <label>
                    Integration token
                    <input readOnly type="password" value={integrationToken} />
                  </label>
                  <button
                    onClick={() =>
                      void navigator.clipboard.writeText(integrationToken)
                    }
                  >
                    Copy token
                  </button>
                </>
              )}
              <p className="hint">
                Set TITAN_AGENT_TOKEN, then run npm run mcp. Webhooks use
                TITAN_WEBHOOK_SECRET.
              </p>
            </div>
            <div className="wide-panel">
              <h2>Background operations</h2>
              {workspace.jobs.map((j: any) => (
                <div className="job-row" key={j.id}>
                  <span>{j.kind}</span>
                  <span className="badge">{j.status}</span>
                  {j.error && <small>{j.error}</small>}
                </div>
              ))}
            </div>
          </section>
        )}
        {view === "learning" && workspace && (
          <section className="wide-panel">
            <div className="learning-summary">
              <span className="agent-icon">⌘</span>
              <div>
                <h2>Your deployment’s learning loop</h2>
                <p>
                  Active ranker:{" "}
                  <strong>{workspace.settings.activeModel}</strong>
                </p>
              </div>
            </div>
            <p>
              Human corrections and review outcomes form a local, versioned
              dataset. Candidate baselines run safety evaluations before
              activation. Custom training is deferred until suitable labels
              exist.
            </p>
            <div className="button-row">
              <button
                className="primary"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await api("/models/evaluate", "POST", {});
                    await refresh();
                  })
                }
              >
                Evaluate baseline candidate
              </button>
              <button
                disabled={busy || !workspace.settings.previousModel}
                onClick={() =>
                  void run(async () => {
                    await api("/models/rollback", "POST", {});
                    await refresh();
                  })
                }
              >
                Roll back
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await api("/datasets", "POST", {});
                    await refresh();
                    setMessage("Dataset manifest captured.");
                  })
                }
              >
                Capture dataset manifest
              </button>
            </div>
            {workspace.models.map((m: any) => (
              <div className="review-card" key={m.id}>
                <span className="badge">
                  {m.evaluation.passed
                    ? "Passed safety fixtures"
                    : "Failed evaluation"}
                </span>
                <h3>Baseline candidate · {m.id.slice(0, 8)}</h3>
                <p>
                  {m.evaluation.correct}/{m.evaluation.total} cases ·{" "}
                  {m.evaluation.suite}
                </p>
                <p className="hint">{m.evaluation.note}</p>
                <button
                  disabled={
                    busy ||
                    !m.evaluation.passed ||
                    m.id === workspace.settings.activeModel
                  }
                  onClick={() =>
                    void run(async () => {
                      await api("/models/" + m.id + "/activate", "POST", {});
                      await refresh();
                    })
                  }
                >
                  Activate candidate
                </button>
              </div>
            ))}
          </section>
        )}
        <footer className="page-footer">
          <span>Your ideas, with the whole story.</span>
          <span>Titan</span>
        </footer>
      </main>
    </div>
  );
}
function Empty({ title, text }: { title: string; text: string }) {
  return (
    <div className="empty">
      <span>◇</span>
      <h2>{title}</h2>
      <p>{text}</p>
    </div>
  );
}
function SettingsForm({
  settings,
  busy,
  save,
}: {
  settings: any;
  busy: boolean;
  save: (patch: any) => Promise<void>;
}) {
  const [provider, setProvider] = useState(settings.provider),
    [model, setModel] = useState(settings.model),
    [autonomy, setAutonomy] = useState(settings.autonomy),
    [webhook, setWebhook] = useState(settings.webhookUrl),
    [embedding, setEmbedding] = useState(settings.embeddingModel);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save({
          provider,
          model,
          autonomy,
          webhookUrl: webhook,
          embeddingModel: embedding,
          credentialRef:
            provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY",
        });
      }}
    >
      <label>
        Model provider
        <select
          value={provider}
          onChange={(e) => {
            setProvider(e.target.value);
            setModel(e.target.value === "fixture" ? "fixture-v1" : "");
          }}
        >
          <option value="fixture">Deterministic demo</option>
          <option value="openai">OpenAI</option>
          <option value="anthropic">Anthropic</option>
        </select>
      </label>
      <label>
        Model ID
        <input
          required
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder="Choose an available model explicitly"
        />
      </label>
      <label>
        Autonomy
        <select value={autonomy} onChange={(e) => setAutonomy(e.target.value)}>
          <option value="bounded">
            Bounded — review consequential changes
          </option>
          <option value="full">Full — automatic within domain rules</option>
        </select>
      </label>
      <label>
        OpenAI embedding model (optional)
        <input
          value={embedding}
          onChange={(e) => setEmbedding(e.target.value)}
          placeholder="Leave empty for full-text + graph retrieval"
        />
      </label>
      <label>
        Work-ready webhook (optional)
        <input
          value={webhook}
          onChange={(e) => setWebhook(e.target.value)}
          placeholder="https://your-workflow.example/events"
        />
      </label>
      <button className="primary" disabled={busy}>
        Save operating policy
      </button>
    </form>
  );
}
