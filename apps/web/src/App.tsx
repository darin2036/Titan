import SettingsShell, {
  settingsRoute,
  type SettingsSection,
} from "./SettingsShell";
import { ConfluenceSource } from "./ConfluenceSource";
import {
  IntegrationCatalog,
  IntegrationConfiguration,
} from "./integrations/IntegrationSettings";
import React, { useState, useEffect, useCallback, useRef } from "react";
import PageActionMenu from "./PageActionMenu";
import RecordMetadata from "./RecordMetadata";
import { recordTypeLabels } from "./record-presentation";
import Markdown from "./record-markdown";
import FloatingAgent from "./FloatingAgent";
import {
  PlacesNavigation,
  RecordOverview,
  PlaceDialog,
  placeContent,
  recordKinds,
} from "./Places";
import type { PlaceView } from "../../shared/places";
import { placeGroupings } from "../../shared/places";
import PageComposer, {
  type PageDraft,
  type ComposerHandle,
} from "./PageComposer";
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
  extensions?: Record<string, unknown>;
};
type Relationship = {
  id: string;
  source: string;
  target: string;
  type: string;
  state: string;
  justification: string;
  evidence: string[];
  revisions: Record<string, string>;
};
type Draft = {
  sources?: Record<string, string>;
  placeId?: string;
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
  all: "All records",
  place: "Overview",
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
  const [settingsSection, setSettingsSection] =
    useState<SettingsSection>("integrations");
  const [integrationId, setIntegrationId] = useState<string | null>(null);
  const [view, setView] = useState("all"),
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
  const [places, setPlaces] = useState<PlaceView[]>([]);
  const [placeId, setPlaceId] = useState<string | null>(null);
  const [searchScope, setSearchScope] = useState<string>("everywhere");
  const searchRequest = useRef(0);
  useEffect(() => {
    setSearchScope(placeId ?? "everywhere");
    searchRequest.current += 1;
    setSearch(null);
  }, [placeId]);
  const [navigationRoot, setNavigationRoot] = useState("");
  const [draftPlaces, setDraftPlaces] = useState<Record<string, string | null>>(
    {},
  );
  const [placeDialog, setPlaceDialog] = useState<PlaceView | "new" | null>(
    null,
  );
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    try {
      return Math.max(
        260,
        Math.min(
          360,
          Number(localStorage.getItem("titan:sidebar-width")) || 300,
        ),
      );
    } catch {
      return 300;
    }
  });
  const [agentOpen, setAgentOpen] = useState(false);
  const [pageNotice, setPageNotice] = useState("");
  const [pageDrafts, setPageDrafts] = useState<PageDraft[]>([]);
  const [pageEditor, setPageEditor] = useState<PageDraft | null>(null);
  const [actionsHost, setActionsHost] = useState<HTMLDivElement | null>(null);
  const pageEditorRef = useRef<ComposerHandle>(null);
  const articleRef = useRef<HTMLElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  function openComposer() {
    setAgentOpen(true);
    requestAnimationFrame(() => composerRef.current?.focus());
  }
  const current = units.find((u) => u.id === selected) ?? null;
  const refresh = useCallback(async () => {
    const [u, w, r, v, e, d, places] = await Promise.all([
      api("/units?removed=true"),
      api("/workspace"),
      api("/relationships"),
      api("/reviews"),
      api("/audit"),
      api("/composer-drafts"),
      api("/places"),
    ]);
    setUnits(u);
    setWorkspace(w);
    setRelations(r);
    setReviews(v);
    setEvents(e);
    setPageDrafts(d);
    setPlaces(places);
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
    if (!workspace?.root) return;
    let restored: {
      placeId?: string;
      view?: string;
      selected?: string;
      draftPlaces?: Record<string, string | null>;
    } = {};
    try {
      restored = JSON.parse(
        localStorage.getItem("titan:navigation:" + workspace.root) ?? "{}",
      );
    } catch {}
    const destination = places.find((place) => place.id === restored?.placeId);
    const record = units.find(
      (unit) => unit.id === restored?.selected && unit.lifecycle === "active",
    );
    const views = [
      "all",
      "place",
      ...recordKinds,
      "reviews",
      "audit",
      "learning",
      "removed",
      "settings",
    ];
    setPlaceId(destination?.id ?? null);
    const returnedFromConfluence = new URLSearchParams(location.search).has(
      "confluence",
    );
    if (returnedFromConfluence) {
      if (new URLSearchParams(location.search).get("confluence") === "error")
        setError(
          "Confluence access wasn’t completed. Connect again in Settings.",
        );
      window.history.replaceState(null, "", location.pathname);
    }
    const route = settingsRoute(location.hash);
    const integrationRoute = route?.integrationId;
    const onSettingsRoute = !!route;
    setSettingsSection(
      returnedFromConfluence
        ? "integrations"
        : (route?.section ?? "integrations"),
    );
    setIntegrationId(
      returnedFromConfluence ? "confluence" : (integrationRoute ?? null),
    );
    if (returnedFromConfluence)
      window.history.replaceState(
        null,
        "",
        location.pathname + "#settings/integrations/confluence",
      );
    setSelected(
      returnedFromConfluence || onSettingsRoute ? null : (record?.id ?? null),
    );
    setView(
      (returnedFromConfluence || onSettingsRoute ? "settings" : record?.kind) ??
        (restored?.view &&
        views.includes(restored.view) &&
        (restored.view !== "place" || destination)
          ? restored.view
          : "all"),
    );
    setNavigationRoot(workspace.root);
    setDraftPlaces(restored?.draftPlaces ?? {});
  }, [workspace?.root]);
  useEffect(() => {
    if (!workspace?.root || navigationRoot !== workspace.root || !connected)
      return;
    try {
      localStorage.setItem(
        "titan:navigation:" + workspace.root,
        JSON.stringify({ placeId, view, selected, draftPlaces }),
      );
    } catch {}
  }, [
    placeId,
    view,
    selected,
    draftPlaces,
    navigationRoot,
    workspace?.root,
    connected,
  ]);
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
  const activePlace = places.find((place) => place.id === placeId);
  const isRecordView =
    recordKinds.includes(view) || view === "all" || view === "place";
  const resultPlace = search
    ? places.find((place) => place.id === searchScope)
    : activePlace;
  const list = (search ?? units)
    .filter((u) => u.lifecycle === "active")
    .filter((u) => !resultPlace || resultPlace.memberIds.includes(u.id))
    .filter((u) => !resultPlace || placeGroupings(resultPlace).includes(u.kind))
    .filter(
      (u) => search !== null || !recordKinds.includes(view) || u.kind === view,
    );
  const heading =
    activePlace && view === "place" ? activePlace.name : labels[view];
  async function savePlace(
    content: ReturnType<typeof placeContent>,
    place?: PlaceView,
  ) {
    const saved = await api(
      place ? "/places/" + place.id : "/places",
      place ? "PUT" : "POST",
      place ? { revision: place.revision, content } : content,
    );
    setPlaces((previous) =>
      place
        ? previous.map((p) => (p.id === saved.id ? saved : p))
        : [...previous, saved],
    );
    if (!place) navigateTo("place", saved.id);
    await refresh();
  }
  function updatePlace(
    place: PlaceView,
    content: ReturnType<typeof placeContent>,
  ) {
    void run(() => savePlace(content, place));
  }
  function navigateTo(next: string, nextPlace: string | null = null) {
    void leaveEditor(() => {
      setPlaceId(nextPlace);
      navigateNow(next);
      setMobileNavOpen(false);
      if (matchMedia("(max-width: 760px)").matches) setAgentOpen(false);
    });
  }
  function openRecord(id: string, nextPlace: string | null = placeId) {
    const unit = units.find((u) => u.id === id && u.lifecycle === "active");
    if (!unit) return;
    void leaveEditor(() => {
      setSelected(id);
      setView(unit.kind);
      setPlaceId(nextPlace);
      setDraft(null);
      setNewUnit(false);
      setSearch(null);
      setQuery("");
      setPageNotice("");
      setMobileNavOpen(false);
      if (matchMedia("(max-width: 760px)").matches) setAgentOpen(false);
    });
  }
  async function addPublishedToPlace(id: string, destination = placeId) {
    if (!destination) return;
    const latest: PlaceView[] = await api("/places");
    const place = latest.find((p) => p.id === destination);
    if (place && !place.memberIds.includes(id))
      await savePlace(
        { ...placeContent(place), memberIds: [...place.memberIds, id] },
        place,
      );
  }
  function draftOverview() {
    if (!activePlace) return;
    void leaveEditor(() => {
      setSelected(null);
      setNewUnit(true);
      setKind("knowledge");
      setDraft(null);
      openComposer();
      void run(async () => {
        const response = await api("/author", "POST", {
          instruction:
            activePlace.name +
            " overview\nSummarize the intent, key decisions, work, and gaps using only the supplied source records.",
          kind: "knowledge",
          placeId: activePlace.id,
        });
        setDraft(response);
        setMessage("Titan prepared a source-based overview for you to review.");
      });
    });
  }
  function resizeSidebar(event: React.PointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function setWidth(value: number) {
    const width = Math.max(260, Math.min(360, value));
    setSidebarWidth(width);
    try {
      localStorage.setItem("titan:sidebar-width", String(width));
    } catch {}
  }
  async function author() {
    if (!instruction.trim()) return;
    await run(async () => {
      const response = await api("/author", "POST", {
        instruction,
        kind,
        ...(activePlace && (newUnit || !current)
          ? { placeId: activePlace.id }
          : {}),
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
          ...(draft.sources
            ? { extensions: { "titan:sources": draft.sources } }
            : {}),
        });
        if (result.id) {
          await addPublishedToPlace(result.id, draft.placeId ?? placeId).catch(
            () =>
              setPageNotice(
                "Published. Add this record to the place through Organize place.",
              ),
          );
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
  async function leaveEditor(next: (saved?: PageDraft) => void) {
    if (pageEditorRef.current?.isWorking()) return;
    try {
      const saved = await pageEditorRef.current?.save();
      setPageEditor(null);
      next(saved);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Save your draft before leaving this page.",
      );
    }
  }
  function startPage(source: Unit | null = null) {
    void leaveEditor(() => {
      setPageNotice("");
      const existing =
        source && pageDrafts.find((d) => d.source?.id === source.id);
      const nextPage = existing || {
        id: crypto.randomUUID(),
        version: 0,
        kind: source?.kind ?? (recordKinds.includes(view) ? view : "knowledge"),
        title: source?.title ?? "",
        body: source?.body ?? "",
        applicability: source?.applicability ?? [],
        source: source ? { id: source.id, revision: source.revision } : null,
        updatedAt: new Date().toISOString(),
      };
      setPageEditor(nextPage);
      setDraftPlaces((previous) =>
        Object.hasOwn(previous, nextPage.id)
          ? previous
          : { ...previous, [nextPage.id]: placeId },
      );
      setSelected(source?.id ?? null);
      setDraft(null);
      setSelection("");
      setNewUnit(false);
      setAgentOpen(false);
    });
  }
  function navigate(next: string) {
    navigateTo(next, null);
  }
  function openIntegration(id: string | null) {
    setSettingsSection("integrations");
    setIntegrationId(id);
    window.history.pushState(
      null,
      "",
      location.pathname +
        (id ? "#settings/integrations/" + id : "#settings/integrations"),
    );
  }
  function openSettingsSection(section: SettingsSection) {
    setIntegrationId(null);
    setSettingsSection(section);
    window.history.pushState(
      null,
      "",
      location.pathname + "#settings/" + section,
    );
  }
  useEffect(() => {
    const handleRoute = () => {
      const route = settingsRoute(location.hash);
      if (route) {
        setSettingsSection(route.section);
        setIntegrationId(route.integrationId);
        setView("settings");
        setSelected(null);
      } else setIntegrationId(null);
    };
    window.addEventListener("popstate", handleRoute);
    window.addEventListener("hashchange", handleRoute);
    return () => {
      window.removeEventListener("popstate", handleRoute);
      window.removeEventListener("hashchange", handleRoute);
    };
  }, []);
  function navigateNow(next: string) {
    setIntegrationId(null);
    if (next === "settings") setSettingsSection("integrations");
    if (location.hash.startsWith("#settings"))
      window.history.replaceState(null, "", location.pathname);
    setPageNotice("");
    setView(next);
    setSearch(null);
    setQuery("");
    setDraft(null);
    setSelected(null);
    setNewUnit(false);
    setKind(recordKinds.includes(next) ? next : "knowledge");
  }
  if (!connected)
    return (
      <div className="login">
        <div className="login-card">
          <div className="brand-mark">T</div>
          <h1>Welcome to Titan</h1>
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
        </div>
      </div>
    );
  return (
    <div
      className="shell places-shell"
      style={{ "--sidebar-width": sidebarWidth + "px" } as React.CSSProperties}
    >
      {placeDialog && (
        <PlaceDialog
          place={placeDialog === "new" ? undefined : placeDialog}
          records={units}
          close={() => setPlaceDialog(null)}
          save={savePlace}
        />
      )}
      <aside
        className={
          "sidebar places-sidebar" + (mobileNavOpen ? " mobile-nav-open" : "")
        }
      >
        <button
          className="mobile-navigation-toggle"
          aria-expanded={mobileNavOpen}
          aria-controls="primary-navigation"
          onClick={() => setMobileNavOpen(!mobileNavOpen)}
        >
          {mobileNavOpen ? "Hide navigation" : "Navigation"}
        </button>
        <a className="brand" href="#" onClick={(e) => e.preventDefault()}>
          <span className="brand-mark">T</span> Titan
        </a>
        <div className="workspace-name">
          <span className="dot" /> Local workspace
        </div>
        <div className="sidebar-content" id="primary-navigation">
          <PlacesNavigation
            places={places}
            orderKey={"titan:place-order:" + (workspace?.root ?? "")}
            records={units}
            placeId={placeId}
            view={view}
            selected={selected}
            navigate={navigateTo}
            openRecord={openRecord}
            newPlace={() => void leaveEditor(() => setPlaceDialog("new"))}
          />
          {!!pageDrafts.length && (
            <>
              <div className="nav-label">Your drafts</div>
              <nav aria-label="Your drafts">
                {pageDrafts.map((d) => (
                  <button
                    key={d.id}
                    className="draft-row"
                    onClick={() =>
                      void leaveEditor((saved) => {
                        setPageEditor(saved?.id === d.id ? saved : d);
                        setView(d.kind);
                        setPlaceId(draftPlaces[d.id] ?? null);
                        setSelected(d.source?.id ?? null);
                        setAgentOpen(false);
                        setDraft(null);
                        setSelection("");
                        setMobileNavOpen(false);
                      })
                    }
                  >
                    <span>{d.title || "Untitled page"}</span>
                    <small>Unpublished{d.source ? " changes" : ""}</small>
                  </button>
                ))}
              </nav>
            </>
          )}
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
        </div>
        <div className="sidebar-bottom">
          <div className="agent-health">
            <span className="dot" />
            {workspace?.settings.provider === "fixture"
              ? "Demo workspace"
              : "Agent connected"}
            <small>
              {workspace?.settings.autonomy === "bounded"
                ? "Review required"
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
        <div
          className="sidebar-resize"
          role="separator"
          aria-label="Navigation width"
          aria-orientation="vertical"
          aria-valuemin={260}
          aria-valuemax={360}
          aria-valuenow={sidebarWidth}
          tabIndex={0}
          onPointerDown={resizeSidebar}
          onPointerMove={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId))
              setWidth(event.clientX);
          }}
          onKeyDown={(event) => {
            if (
              ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
            ) {
              event.preventDefault();
              setWidth(
                event.key === "Home"
                  ? 260
                  : event.key === "End"
                    ? 360
                    : sidebarWidth + (event.key === "ArrowRight" ? 10 : -10),
              );
            }
          }}
        />
      </aside>
      <main>
        <header className="topbar">
          <nav className="breadcrumbs" aria-label="Breadcrumb">
            {activePlace ? (
              <>
                <button
                  className="breadcrumb-button"
                  onClick={() => navigateTo("place", activePlace.id)}
                >
                  {activePlace.name}
                </button>
                <span className="breadcrumb" aria-hidden="true">
                  /
                </span>
              </>
            ) : (
              <>
                <button
                  className="breadcrumb-button"
                  onClick={() => navigateTo("all", null)}
                >
                  Workspace
                </button>
                <span className="breadcrumb" aria-hidden="true">
                  /
                </span>
              </>
            )}
            <span className="breadcrumb-current" aria-current="page">
              {pageEditor
                ? "Draft"
                : current
                  ? recordTypeLabels[current.kind]
                  : labels[view]}
            </span>
          </nav>
          <form
            className="search global-search"
            role="search"
            onSubmit={(event) => {
              event.preventDefault();
              const submittedQuery = query.trim();
              const request = ++searchRequest.current;
              void leaveEditor(() => {
                void run(async () => {
                  const results = submittedQuery
                    ? await api("/context", "POST", { query: submittedQuery })
                    : null;
                  if (request !== searchRequest.current) return;
                  navigateNow(placeId ? "place" : "all");
                  setQuery(submittedQuery);
                  setSearch(results);
                  setAgentOpen(false);
                });
              });
            }}
          >
            <select
              aria-label="Search scope"
              value={searchScope}
              onChange={(event) => {
                searchRequest.current += 1;
                setSearchScope(event.target.value);
              }}
            >
              <option value="everywhere">Everywhere</option>
              {places.map((place) => (
                <option key={place.id} value={place.id}>
                  {place.name}
                </option>
              ))}
            </select>
            <input
              aria-label="Search knowledge and work"
              placeholder="Search records…"
              value={query}
              onChange={(event) => {
                searchRequest.current += 1;
                setQuery(event.target.value);
                if (!event.target.value) setSearch(null);
              }}
            />
            <button type="submit" aria-label="Search" disabled={busy}>
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                aria-hidden="true"
                focusable="false"
              >
                <circle cx="10.5" cy="10.5" r="6.5" />
                <path d="m16 16 4.5 4.5" />
              </svg>
            </button>
          </form>
          <div
            className="top-actions"
            ref={setActionsHost}
            id="document-actions"
          >
            {!current && !pageEditor && isRecordView && (
              <div className="button-row">
                <button className="primary" onClick={() => startPage()}>
                  ＋ New page
                </button>
                <button
                  onClick={() => {
                    void leaveEditor(() => {
                      setNewUnit(true);
                      setSelected(null);
                      setDraft(null);
                      setInstruction("");
                      setMessage("");
                      openComposer();
                    });
                  }}
                >
                  Draft with agent
                </button>
              </div>
            )}
            {current && !pageEditor && isRecordView && (
              <button disabled={busy} onClick={() => startPage(current)}>
                Edit page
              </button>
            )}
            {current && !pageEditor && isRecordView && (
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
            {current &&
              !pageEditor &&
              activePlace &&
              activePlace.memberIds.includes(current.id) && (
                <PageActionMenu>
                  <button
                    disabled={busy}
                    onClick={() =>
                      updatePlace(activePlace, {
                        ...placeContent(activePlace),
                        pinnedIds: activePlace.pinnedIds.includes(current.id)
                          ? activePlace.pinnedIds.filter(
                              (id) => id !== current.id,
                            )
                          : [...activePlace.pinnedIds, current.id],
                      })
                    }
                  >
                    {activePlace.pinnedIds.includes(current.id)
                      ? "Unpin page"
                      : "Pin page"}
                  </button>
                </PageActionMenu>
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
        {pageNotice && (
          <div className="page-notice" role="status">
            {pageNotice}
          </div>
        )}
        {!current && !pageEditor && (
          <div className="page-heading">
            {!(view === "settings" && integrationId) && <h1>{heading}</h1>}
          </div>
        )}
        {isRecordView && (
          <div
            className={
              "workspace-grid" +
              (current || pageEditor ? " document-sheet" : "") +
              (pageEditor ? " composing-page" : "")
            }
          >
            {!current && !pageEditor && (
              <div className="browse-canvas">
                {search && (
                  <div className="section-label">
                    Search results <span>{list.length}</span>
                  </div>
                )}
                <RecordOverview
                  records={list}
                  allRecords={units}
                  place={resultPlace}
                  openRecord={(id) => openRecord(id, resultPlace?.id ?? null)}
                  organize={() => activePlace && setPlaceDialog(activePlace)}
                  update={updatePlace}
                  busy={busy}
                  draftOverview={draftOverview}
                />
              </div>
            )}
            {(current || pageEditor) && (
              <section className="document-panel">
                {pageEditor ? (
                  <PageComposer
                    key={pageEditor.id}
                    ref={pageEditorRef}
                    initial={pageEditor}
                    publishDisabledReason={
                      (
                        units.find((u) => u.id === pageEditor.source?.id)
                          ?.extensions?.["titan:confluence"] as any
                      )?.owner === "confluence"
                        ? !workspace?.confluence?.allowEdits
                          ? "This connection is read only. Enable edits in Settings to save to Confluence."
                          : (
                                units.find(
                                  (u) => u.id === pageEditor.source?.id,
                                )?.extensions?.["titan:confluence"] as any
                              )?.issues?.length
                            ? "This page has source formatting Titan cannot safely write back. Your draft stays private."
                            : undefined
                        : undefined
                    }
                    publishLabel={
                      (
                        units.find((u) => u.id === pageEditor.source?.id)
                          ?.extensions?.["titan:confluence"] as any
                      )?.owner === "confluence"
                        ? "Save to Confluence"
                        : undefined
                    }
                    actionsHost={actionsHost}
                    onAskAgent={openComposer}
                    api={api}
                    onSaved={(d) =>
                      setPageDrafts((previous) => [
                        d,
                        ...previous.filter((item) => item.id !== d.id),
                      ])
                    }
                    onClose={() => setPageEditor(null)}
                    onDiscard={(id) => {
                      setPageDrafts((previous) =>
                        previous.filter((d) => d.id !== id),
                      );
                      setPageEditor(null);
                    }}
                    onPublished={async (unit) => {
                      setPageDrafts((previous) =>
                        previous.filter((d) => d.id !== pageEditor.id),
                      );
                      setPageEditor(null);
                      setSelected(unit.id);
                      setView(unit.kind);
                      setSearch(null);
                      setMessage(
                        "Published. Titan is checking related knowledge and recording the change.",
                      );
                      setPageNotice(
                        "Published. Titan is checking related knowledge.",
                      );
                      if (!pageEditor.source)
                        await addPublishedToPlace(
                          unit.id,
                          draftPlaces[pageEditor.id] ?? null,
                        ).catch(() =>
                          setPageNotice(
                            "Published. Add this record to the place through Organize place.",
                          ),
                        );
                      await refresh().catch(() =>
                        setError(
                          "Your page was published, but Titan couldn’t refresh the view. Reload to see it.",
                        ),
                      );
                    }}
                  />
                ) : current ? (
                  <>
                    <h1 className="document-title">{current.title}</h1>
                    <RecordMetadata
                      key={current.id}
                      record={current}
                      events={events}
                      records={units}
                      relationships={relations}
                      openRecord={openRecord}
                      prepareReview={() => {
                        setInstruction(
                          `Review the recorded basis for "${current.title}" (record ${current.id}). Explain what needs attention and prepare evidence connections or changes for my review.`,
                        );
                        openComposer();
                      }}
                    />
                    {!!current.extensions?.["titan:confluence"] && (
                      <ConfluenceSource
                        key={current.id}
                        source={current.extensions["titan:confluence"]}
                        recordId={current.id}
                        api={api}
                        refresh={refresh}
                      />
                    )}
                    {!!current.extensions?.["titan:sources"] && (
                      <details className="record-details">
                        <summary>Source records</summary>
                        {Object.keys(
                          current.extensions["titan:sources"] as Record<
                            string,
                            string
                          >,
                        ).map((id) => (
                          <button
                            key={id}
                            disabled={
                              !units.some(
                                (u) => u.id === id && u.lifecycle === "active",
                              )
                            }
                            onClick={() => openRecord(id)}
                          >
                            {units.find((u) => u.id === id)?.title ??
                              "Unavailable record"}
                          </button>
                        ))}
                      </details>
                    )}
                    {!!current.extensions?.["titan:sources"] &&
                      Object.entries(
                        current.extensions["titan:sources"] as Record<
                          string,
                          string
                        >,
                      ).some(
                        ([id, revision]) =>
                          !units.some(
                            (u) =>
                              u.id === id &&
                              u.lifecycle === "active" &&
                              u.revision === revision,
                          ),
                      ) && (
                        <div className="notice">
                          A source changed or was removed. Prepare a fresh
                          overview before using this page as a basis.
                        </div>
                      )}

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
                                    void leaveEditor(() => {
                                      setSelected(unit.id);
                                      setView(unit.kind);
                                    });
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
                          const type =
                            workspace?.settings.relationshipTypes.find(
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
                    <h2>
                      {newUnit || !list.length
                        ? "Create a page"
                        : "Choose a record"}
                    </h2>
                    <button
                      className="empty-action"
                      onClick={() => startPage()}
                    >
                      ＋ Create a page
                    </button>
                  </div>
                )}
              </section>
            )}
          </div>
        )}
        <FloatingAgent
          open={agentOpen}
          onOpen={openComposer}
          onClose={() => setAgentOpen(false)}
          selection={!!selection}
          subtitle={workspace?.settings.provider === "fixture" ? "Demo" : ""}
        >
          <div className="conversation-content">
            {message && (
              <div className="agent-message">
                <p>{message}</p>
              </div>
            )}
            {selection && (
              <div className="selection" role="status">
                <div className="selection-heading">
                  <span>Selected passage</span>
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
                {draft.sources && (
                  <details>
                    <summary>
                      Source records · {Object.keys(draft.sources).length}
                    </summary>
                    {Object.entries(draft.sources).map(([id, revision]) => (
                      <div className="draft-source" key={id}>
                        <span>
                          {units.find((u) => u.id === id)?.title ??
                            "Unavailable record"}
                        </span>
                        <code>{revision.slice(0, 7)}</code>
                      </div>
                    ))}
                  </details>
                )}
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
                <select value={kind} onChange={(e) => setKind(e.target.value)}>
                  {["knowledge", "work", "decision", "evidence"].map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
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
        {view === "reviews" && (
          <section className="wide-panel">
            {!reviewCount ? (
              <Empty title="Nothing waiting on you" />
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
              <Empty title="No removed records" />
            )}
          </section>
        )}
        {view === "settings" && workspace && (
          <SettingsShell
            section={settingsSection}
            navigate={openSettingsSection}
          >
            {settingsSection === "integrations" &&
              (integrationId ? (
                <IntegrationConfiguration
                  key={integrationId}
                  id={integrationId}
                  api={api}
                  refresh={refresh}
                  back={() => openIntegration(null)}
                />
              ) : (
                <IntegrationCatalog api={api} open={openIntegration} />
              ))}
            {settingsSection === "repository" && (
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
            )}
            {settingsSection === "intelligence" && (
              <div className="wide-panel">
                <h2>Intelligence & autonomy</h2>
                <SettingsForm
                  settings={workspace.settings}
                  credentials={workspace.credentials}
                  act={run}
                  refresh={refresh}
                  busy={busy}
                />
                <details className="document-section">
                  <summary>Connection details</summary>
                  <p className="hint">
                    API keys are stored in private server state or supplied
                    through environment variables. OpenAI:{" "}
                    {workspace.credentials.openai
                      ? "configured"
                      : "not configured"}{" "}
                    · Anthropic:{" "}
                    {workspace.credentials.anthropic
                      ? "configured"
                      : "not configured"}{" "}
                    · Custom:{" "}
                    {workspace.credentials.custom
                      ? "configured"
                      : "not configured"}
                  </p>
                  <div className="notice">
                    Fixture mode uses explicit references for deterministic
                    relationships. Live modes infer relationships from supplied
                    context.
                  </div>
                </details>
              </div>
            )}
            {settingsSection === "access" && (
              <div className="wide-panel">
                <h2>Agent access</h2>
                <p>Read/write access. The token is shown only once.</p>
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
                      <input
                        readOnly
                        type="password"
                        value={integrationToken}
                      />
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
                <details className="document-section">
                  <summary>Setup instructions</summary>
                  <p className="hint">
                    Set TITAN_AGENT_TOKEN, then run npm run mcp. Webhooks use
                    TITAN_WEBHOOK_SECRET.
                  </p>
                </details>
              </div>
            )}
            {settingsSection === "operations" && (
              <div className="wide-panel">
                <h2>Background operations</h2>
                {!workspace.jobs.length && (
                  <p className="hint">No background operations are queued.</p>
                )}
                {workspace.jobs.map((j: any) => (
                  <div className="job-row" key={j.id}>
                    <span>{j.kind}</span>
                    <span className="badge">{j.status}</span>
                    {j.error && <small>{j.error}</small>}
                  </div>
                ))}
              </div>
            )}
          </SettingsShell>
        )}
        {view === "learning" && workspace && (
          <section className="wide-panel">
            <div className="learning-summary">
              <span className="agent-icon">⌘</span>
              <div>
                <h2>Active model</h2>
                <p>
                  Active ranker:{" "}
                  <strong>{workspace.settings.activeModel}</strong>
                </p>
              </div>
            </div>
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
      </main>
    </div>
  );
}
function Empty({ title }: { title: string }) {
  return (
    <div className="empty">
      <h2>{title}</h2>
    </div>
  );
}
function SettingsForm({
  credentials,
  act,
  refresh,
  settings,
  busy,
}: {
  credentials: Record<string, boolean>;
  act: (fn: () => Promise<void>) => Promise<void>;
  refresh: () => Promise<void>;
  settings: any;
  busy: boolean;
}) {
  const [apiKey, setApiKey] = useState("");
  const [connectionMessage, setConnectionMessage] = useState("");
  const [provider, setProvider] = useState(settings.provider),
    [model, setModel] = useState(settings.model),
    [autonomy, setAutonomy] = useState(settings.autonomy),
    [webhook, setWebhook] = useState(settings.webhookUrl),
    [embedding, setEmbedding] = useState(settings.embeddingModel);
  const [baseUrl, setBaseUrl] = useState(settings.providerBaseUrl ?? "");
  const providerName =
    provider === "openai"
      ? "OpenAI"
      : provider === "anthropic"
        ? "Claude"
        : "Custom provider";
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void act(async () => {
          if (provider !== "fixture" && apiKey.trim()) {
            await api("/intelligence/credentials", "PUT", {
              provider,
              apiKey: apiKey.trim(),
            });
            setApiKey("");
          }
          await api("/settings", "PATCH", {
            provider,
            model,
            autonomy,
            webhookUrl: webhook,
            embeddingModel: embedding,
            credentialRef:
              provider === "anthropic"
                ? "ANTHROPIC_API_KEY"
                : provider === "custom"
                  ? "CUSTOM_API_KEY"
                  : "OPENAI_API_KEY",
            providerBaseUrl: provider === "custom" ? baseUrl : "",
          });
          await refresh();
          setConnectionMessage("Intelligence settings saved.");
        });
      }}
    >
      <label>
        Model provider
        <select
          value={provider}
          onChange={(e) => {
            setApiKey("");
            setConnectionMessage("");
            setProvider(e.target.value);
            setModel(e.target.value === "fixture" ? "fixture-v1" : "");
          }}
        >
          <option value="fixture">Deterministic demo</option>
          <option value="openai">OpenAI</option>
          <option value="anthropic">Claude (Anthropic)</option>
          <option value="custom">Custom (OpenAI-compatible)</option>
        </select>
      </label>
      {provider === "custom" && (
        <label>
          API base URL
          <input
            required
            type="url"
            value={baseUrl}
            onChange={(e) => {
              setBaseUrl(e.target.value);
              setConnectionMessage("");
            }}
            placeholder="https://your-provider.example/v1"
          />
          <span className="hint">
            Use an OpenAI-compatible Chat Completions endpoint. Local servers
            can use HTTP on localhost.
          </span>
        </label>
      )}
      <label>
        {provider === "fixture" ? "Demo model" : `${providerName} model ID`}
        <input
          required
          readOnly={provider === "fixture"}
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder={
            provider === "anthropic"
              ? "Enter your Claude model ID"
              : provider === "custom"
                ? "Enter the model ID served by your endpoint"
                : "Enter your OpenAI model ID"
          }
        />
      </label>
      {provider !== "fixture" && (
        <div className="document-section">
          <label>
            {providerName} API key{provider === "custom" ? " (optional)" : ""}
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={apiKey}
              onChange={(e) => {
                setApiKey(e.target.value);
                setConnectionMessage("");
              }}
              placeholder={
                credentials[provider]
                  ? "A key is configured. Enter a new key to replace it."
                  : "Paste your API key"
              }
            />
          </label>
          <p className="hint">
            {credentials[provider]
              ? "API key configured."
              : provider === "custom"
                ? "Leave the key empty if your endpoint does not require authentication."
                : "Add an API key to connect."}{" "}
            Titan stores your key on this server, outside the workspace
            repository.
          </p>
          {provider === "openai" && (
            <a
              href="https://platform.openai.com/api-keys"
              target="_blank"
              rel="noreferrer"
            >
              Create an OpenAI API key
            </a>
          )}
          {provider === "anthropic" && (
            <a
              href="https://console.anthropic.com/settings/keys"
              target="_blank"
              rel="noreferrer"
            >
              Create an Anthropic API key
            </a>
          )}
          <div className="intelligence-credential-actions">
            <button
              type="button"
              disabled={busy || !apiKey.trim()}
              onClick={() =>
                void act(async () => {
                  setConnectionMessage("");
                  await api("/intelligence/credentials", "PUT", {
                    provider,
                    apiKey: apiKey.trim(),
                  });
                  setApiKey("");
                  setConnectionMessage("API key saved.");
                  await refresh();
                })
              }
            >
              Save API key
            </button>
            <button
              type="button"
              disabled={
                busy ||
                !model.trim() ||
                (provider !== "custom" &&
                  !apiKey.trim() &&
                  !credentials[provider]) ||
                (provider === "custom" && !baseUrl.trim())
              }
              onClick={() =>
                void act(async () => {
                  setConnectionMessage("");
                  if (apiKey.trim()) {
                    await api("/intelligence/credentials", "PUT", {
                      provider,
                      apiKey: apiKey.trim(),
                    });
                    setApiKey("");
                    await refresh();
                  }
                  await api("/intelligence/test", "POST", {
                    provider,
                    model,
                    providerBaseUrl: provider === "custom" ? baseUrl : "",
                  });
                  setConnectionMessage(
                    "Connected. This model is ready to use. Save operating policy to use it in Titan.",
                  );
                })
              }
            >
              Test connection
            </button>
            <button
              type="button"
              disabled={busy || !credentials[provider]}
              onClick={() =>
                void act(async () => {
                  setConnectionMessage("");
                  await api("/intelligence/credentials", "PUT", {
                    provider,
                    apiKey: "",
                  });
                  setApiKey("");
                  await refresh();
                  setConnectionMessage(
                    "Saved key removed. A server environment key, if supplied, remains available.",
                  );
                })
              }
            >
              Remove saved key
            </button>
          </div>
          <p className="hint" role="status">
            {connectionMessage}
          </p>
          <p className="hint">
            Testing makes a small model request and may incur API usage charges.
          </p>
        </div>
      )}
      <label>
        Autonomy
        <select value={autonomy} onChange={(e) => setAutonomy(e.target.value)}>
          <option value="bounded">
            Bounded — review consequential changes
          </option>
          <option value="full">Full — automatic within domain rules</option>
        </select>
      </label>
      <details className="document-section">
        <summary>Search embeddings (OpenAI)</summary>
        <p className="hint">
          Optional embeddings use a separate OpenAI key and model, regardless of
          your authoring provider. Full-text and graph search work without them.
        </p>
        <label>
          OpenAI embedding model (optional)
          <input
            value={embedding}
            onChange={(e) => setEmbedding(e.target.value)}
            placeholder="Leave empty for full-text + graph retrieval"
          />
        </label>
      </details>
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
