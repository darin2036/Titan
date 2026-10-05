import { useEffect, useRef, useState } from "react";
import { orderPlaces, placeGroup as group } from "./place-order";
import type { Place, PlaceView } from "../../shared/places";
import {
  placeGroupings,
  placeRecordKinds,
  type PlaceRecordKind,
} from "../../shared/places";

export type NavigationRecord = {
  id: string;
  title: string;
  kind: string;
  lifecycle: string;
  validity: string;
  status: string;
};
export const recordKinds: string[] = [...placeRecordKinds];
const labels: Record<string, string> = {
  knowledge: "Knowledge",
  work: "Work",
  decision: "Decisions",
  evidence: "Evidence",
};
const symbols: Record<string, string> = {
  knowledge: "◈",
  work: "▤",
  decision: "◇",
  evidence: "✓",
};
export function placeContent(place: Place) {
  const { name, type, organization, memberIds, pinnedIds, groupings } = place;
  return { name, type, organization, memberIds, pinnedIds, groupings };
}
export function PlacesNavigation({
  places,
  orderKey,
  records,
  placeId,
  view,
  selected,
  navigate,
  openRecord,
  newPlace,
}: {
  places: PlaceView[];
  orderKey: string;
  records: NavigationRecord[];
  placeId: string | null;
  view: string;
  selected: string | null;
  navigate: (view: string, placeId?: string | null) => void;
  openRecord: (id: string, placeId: string | null) => void;
  newPlace: () => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [allExpanded, setAllExpanded] = useState(false);
  const [order, setOrder] = useState<string[]>([]);
  const [dragged, setDragged] = useState<string | null>(null);
  const [insertion, setInsertion] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [autoGroup, setAutoGroup] = useState(true);
  const [finding, setFinding] = useState(false);
  const actions = useRef<HTMLDivElement>(null);
  const actionsTrigger = useRef<HTMLButtonElement>(null);
  const [menuPosition, setMenuPosition] = useState({ left: 0, top: 0 });
  useEffect(() => {
    let saved: unknown;
    try {
      saved = JSON.parse(localStorage.getItem(orderKey) ?? "[]");
    } catch {}
    setOrder(
      Array.isArray(saved)
        ? saved.filter((id): id is string => typeof id === "string")
        : [],
    );
    setDragged(null);
    setInsertion(null);
    try {
      setAutoGroup(localStorage.getItem(orderKey + ":auto-group") !== "false");
    } catch {
      setAutoGroup(true);
    }
  }, [orderKey]);
  const orderedPlaces = orderPlaces(places, order, autoGroup);
  function movePlace(id: string, boundary: number) {
    const ids = orderedPlaces.map((place) => place.id);
    const from = ids.indexOf(id);
    if (from < 0) return;
    ids.splice(from, 1);
    const to = boundary > from ? boundary - 1 : boundary;
    if (
      autoGroup &&
      orderedPlaces[to] &&
      group(orderedPlaces[from]) !== group(orderedPlaces[to])
    ) {
      setAnnouncement(
        "Turn off Auto Group Places to move places between groups.",
      );
      return;
    }
    ids.splice(to, 0, id);
    setOrder(ids);
    try {
      localStorage.setItem(orderKey, JSON.stringify(ids));
    } catch {}
    setAnnouncement(
      `${places.find((place) => place.id === id)?.name} moved to position ${to + 1} of ${ids.length}.`,
    );
  }
  function endDrag() {
    setDragged(null);
    setInsertion(null);
  }

  useEffect(() => {
    if (placeId) setExpanded((previous) => new Set([...previous, placeId]));
  }, [placeId]);
  const activeRecords = records.filter(
    (record) => record.lifecycle === "active",
  );
  const pins = places
    .flatMap((place) =>
      place.pinnedIds.map((id) => ({
        place,
        record: activeRecords.find(
          (u) => u.id === id && placeGroupings(place).includes(u.kind),
        ),
      })),
    )
    .filter(
      (entry): entry is { place: PlaceView; record: NavigationRecord } =>
        !!entry.record,
    )
    .filter(
      (entry, index, all) =>
        all.findIndex((p) => p.record.id === entry.record.id) === index,
    );
  return (
    <>
      <nav aria-label="Browse workspace">
        <div className="place-parent">
          <button
            className={
              view === "all" && !placeId && !selected ? "nav active" : "nav"
            }
            onClick={() => navigate("all", null)}
          >
            <span aria-hidden="true" className="nav-records-icon">
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                focusable="false"
              >
                <rect x="4" y="3" width="12" height="15" rx="2" />
                <path d="M8 7h4M8 11h4M8 18v1a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-2" />
              </svg>
            </span>
            All records
          </button>
          <button
            className="place-expand"
            aria-label="Expand record types"
            aria-expanded={allExpanded}
            onClick={() => setAllExpanded(!allExpanded)}
          >
            {allExpanded ? "▾" : "▸"}
          </button>
        </div>
        {allExpanded && (
          <div className="place-children">
            {recordKinds.map((kind) => (
              <button
                key={kind}
                className={
                  view === kind && !placeId && !selected ? "nav active" : "nav"
                }
                onClick={() => navigate(kind, null)}
              >
                <span>{symbols[kind]}</span>
                {labels[kind]}
                <small>
                  {activeRecords.filter((u) => u.kind === kind).length}
                </small>
              </button>
            ))}
          </div>
        )}
      </nav>
      {!!pins.length && (
        <>
          <div className="nav-label">Pinned</div>
          <nav aria-label="Pinned records">
            {pins.map(({ place, record }) => (
              <button
                key={record.id}
                className={
                  selected === record.id &&
                  placeId === place.id &&
                  !expanded.has(place.id)
                    ? "nav active"
                    : "nav"
                }
                onClick={() => openRecord(record.id, place.id)}
                title={record.title}
              >
                <span>{symbols[record.kind]}</span>
                <span className="nav-title">{record.title}</span>
              </button>
            ))}
          </nav>
        </>
      )}
      <div className="places-heading">
        <div className="nav-label">Places</div>
        <button
          className="place-expand"
          ref={actionsTrigger}
          aria-label="Places actions"
          popoverTarget="places-actions"
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            setMenuPosition({
              left: Math.max(8, Math.min(rect.left, window.innerWidth - 232)),
              top: Math.max(
                8,
                Math.min(rect.bottom + 4, window.innerHeight - 140),
              ),
            });
          }}
        >
          ＋
        </button>
      </div>
      <div
        id="places-actions"
        ref={actions}
        popover="auto"
        className="places-action-options"
        style={menuPosition}
        role="group"
        aria-label="Places actions"
      >
        <button
          onClick={() => {
            actions.current?.hidePopover();
            newPlace();
          }}
        >
          Create new place
        </button>
        <button
          onClick={() => {
            actions.current?.hidePopover();
            setFinding(true);
          }}
        >
          Find Place
        </button>
        <button
          aria-pressed={autoGroup}
          onClick={() => {
            setAutoGroup(!autoGroup);
            try {
              localStorage.setItem(
                orderKey + ":auto-group",
                String(!autoGroup),
              );
            } catch {}
            actions.current?.hidePopover();
            actionsTrigger.current?.focus();
          }}
        >
          <span>Auto Group Places</span>
          <span aria-hidden="true">{autoGroup ? "✓" : ""}</span>
        </button>
      </div>
      {finding && (
        <FindPlaceDialog
          places={orderedPlaces}
          close={() => {
            setFinding(false);
            actionsTrigger.current?.focus();
          }}
          choose={(id) => {
            setFinding(false);
            navigate("place", id);
          }}
        />
      )}
      <span className="sr-only" aria-live="polite">
        {announcement}
      </span>
      <nav
        aria-label="Places"
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null))
            setInsertion(null);
        }}
      >
        {orderedPlaces.map((place, index) => {
          const members = activeRecords.filter(
            (u) =>
              place.memberIds.includes(u.id) &&
              placeGroupings(place).includes(u.kind),
          );
          const open = expanded.has(place.id);
          return (
            <div
              className={
                "place-tree" + (dragged === place.id ? " place-dragging" : "")
              }
              key={place.id}
              onDragOver={(event) => {
                if (!dragged) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                const bounds = event.currentTarget.getBoundingClientRect();
                setInsertion(
                  index +
                    (event.clientY >= bounds.top + bounds.height / 2 ? 1 : 0),
                );
              }}
              onDrop={(event) => {
                if (!dragged || insertion === null) return;
                event.preventDefault();
                movePlace(dragged, insertion);
                endDrag();
              }}
            >
              {autoGroup &&
                (index === 0 ||
                  group(place) !== group(orderedPlaces[index - 1])) && (
                  <div className="place-group-label">
                    {group(place) === 0
                      ? "Teams and custom"
                      : "Projects and initiatives"}
                  </div>
                )}
              {insertion === index && <div className="place-insertion" />}
              <div className="place-parent">
                <button
                  className="place-expand"
                  aria-label={(open ? "Collapse " : "Expand ") + place.name}
                  aria-expanded={open}
                  aria-controls={"place-" + place.id}
                  onClick={() =>
                    setExpanded((previous) => {
                      const next = new Set(previous);
                      if (open) next.delete(place.id);
                      else next.add(place.id);
                      return next;
                    })
                  }
                >
                  {open ? "▾" : "▸"}
                </button>
                <button
                  className={
                    !open &&
                    placeId === place.id &&
                    view === "place" &&
                    !selected
                      ? "nav active"
                      : "nav"
                  }
                  onClick={() => navigate("place", place.id)}
                  title={
                    place.name + " — Drag to reorder, or use Alt + Arrow keys"
                  }
                  draggable
                  aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
                  onDragStart={(event) => {
                    setDragged(place.id);
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", place.id);
                  }}
                  onDragEnd={endDrag}
                  onKeyDown={(event) => {
                    if (
                      !event.altKey ||
                      !["ArrowUp", "ArrowDown"].includes(event.key)
                    )
                      return;
                    event.preventDefault();
                    if (event.key === "ArrowUp" && index > 0)
                      movePlace(place.id, index - 1);
                    if (
                      event.key === "ArrowDown" &&
                      index < orderedPlaces.length - 1
                    )
                      movePlace(place.id, index + 2);
                  }}
                >
                  <span className="nav-title">{place.name}</span>
                </button>
              </div>
              {open && (
                <div className="place-children" id={"place-" + place.id}>
                  <button
                    className={
                      placeId === place.id && view === "place" && !selected
                        ? "nav active"
                        : "nav"
                    }
                    onClick={() => navigate("place", place.id)}
                  >
                    Overview
                  </button>
                  {place.pinnedIds
                    .map((id) => members.find((u) => u.id === id))
                    .filter((u): u is NavigationRecord => !!u)
                    .map((record) => (
                      <button
                        key={record.id}
                        className={
                          selected === record.id && placeId === place.id
                            ? "nav active"
                            : "nav"
                        }
                        onClick={() => openRecord(record.id, place.id)}
                        title={record.title}
                      >
                        <span>{symbols[record.kind]}</span>
                        <span className="nav-title">{record.title}</span>
                      </button>
                    ))}
                  {placeGroupings(place).map((kind) => (
                    <button
                      key={kind}
                      className={
                        placeId === place.id && view === kind && !selected
                          ? "nav active"
                          : "nav"
                      }
                      onClick={() => navigate(kind, place.id)}
                    >
                      <span>{symbols[kind]}</span>
                      {labels[kind]}
                      <small>
                        {members.filter((u) => u.kind === kind).length}
                      </small>
                    </button>
                  ))}
                </div>
              )}
              {insertion === orderedPlaces.length &&
                index === orderedPlaces.length - 1 && (
                  <div className="place-insertion place-insertion-end" />
                )}
            </div>
          );
        })}
        {!places.length && (
          <button className="nav" onClick={newPlace}>
            <span>＋</span>Create a place
          </button>
        )}
      </nav>
    </>
  );
}

function FindPlaceDialog({
  places,
  close,
  choose,
}: {
  places: PlaceView[];
  close: () => void;
  choose: (id: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState("");
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const matches = places.filter((place) =>
    (place.name + " " + place.type)
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase()),
  );
  return (
    <dialog
      ref={dialog}
      className="place-dialog find-place-dialog"
      aria-labelledby="find-place-title"
      onCancel={close}
    >
      <h2 id="find-place-title">Find Place</h2>
      <label>
        Search places
        <input
          autoFocus
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && matches.length === 1)
              choose(matches[0].id);
          }}
        />
      </label>
      <div className="find-place-results">
        {matches.map((place) => (
          <button key={place.id} onClick={() => choose(place.id)}>
            <span>{place.name}</span>
            <small>{place.type}</small>
          </button>
        ))}
        {!matches.length && (
          <p role="status">
            {places.length ? "No matching places." : "No places yet."}
          </p>
        )}
      </div>
      <div className="button-row">
        <button onClick={close}>Close</button>
      </div>
    </dialog>
  );
}

export function RecordOverview({
  records,
  allRecords,
  place,
  openRecord,
  organize,
  update,
  busy,
  draftOverview,
}: {
  records: NavigationRecord[];
  allRecords: NavigationRecord[];
  place?: PlaceView;
  openRecord: (id: string) => void;
  organize: () => void;
  update: (place: PlaceView, content: ReturnType<typeof placeContent>) => void;
  busy: boolean;
  draftOverview: () => void;
}) {
  function row(record: NavigationRecord) {
    return (
      <div className="overview-record" key={record.id}>
        <button className="record-card" onClick={() => openRecord(record.id)}>
          <span className="record-row-title">
            <span aria-hidden="true">{symbols[record.kind]}</span>
            {record.title}
          </span>
          <span className="record-row-meta">
            {record.kind === "work"
              ? record.status.replaceAll("_", " ")
              : record.validity}
          </span>
        </button>
        {place && (
          <button
            className="pin-record"
            disabled={busy}
            aria-label={
              (place.pinnedIds.includes(record.id) ? "Unpin " : "Pin ") +
              record.title
            }
            onClick={() =>
              update(place, {
                ...placeContent(place),
                pinnedIds: place.pinnedIds.includes(record.id)
                  ? place.pinnedIds.filter((id) => id !== record.id)
                  : [...place.pinnedIds, record.id],
              })
            }
          >
            {place.pinnedIds.includes(record.id) ? "Unpin" : "Pin"}
          </button>
        )}
      </div>
    );
  }
  const pinned = place
    ? place.pinnedIds
        .map((id) => records.find((u) => u.id === id))
        .filter((u): u is NavigationRecord => !!u)
    : [];
  const other = records.filter((u) => !pinned.some((p) => p.id === u.id));
  return (
    <section className="records-overview">
      {place && (
        <div className="place-controls">
          <span className="eyebrow">{place.type}</span>
          <label>
            Organization
            <select
              aria-label="Organization"
              value={place.organization}
              disabled={busy}
              onChange={(e) =>
                update(place, {
                  ...placeContent(place),
                  organization: e.target.value as Place["organization"],
                })
              }
            >
              <option value="assisted">Titan-assisted</option>
              <option value="manual">Manual</option>
            </select>
          </label>
          <button onClick={organize}>Organize place</button>
        </div>
      )}
      {!!pinned.length && (
        <section className="overview-section">
          <h2>Key pages</h2>
          {pinned.map(row)}
        </section>
      )}
      {recordKinds
        .filter((kind) => other.some((u) => u.kind === kind))
        .map((kind) => (
          <section className="overview-section" key={kind}>
            <h2>{place && kind === "knowledge" ? "Pages" : labels[kind]}</h2>
            {other.filter((u) => u.kind === kind).map(row)}
          </section>
        ))}
      {!records.length && (
        <div className="empty small">
          <h3>{place ? "Add records to this place" : "No records yet"}</h3>
          {place && <button onClick={organize}>Choose records</button>}
        </div>
      )}
      {place?.organization === "assisted" && (
        <section className="overview-section suggestions">
          <div className="overview-section-heading">
            <h2>Connected records</h2>
            <button disabled={busy || !records.length} onClick={draftOverview}>
              Draft overview
            </button>
          </div>
          {place.suggestions
            .filter((s) =>
              allRecords.some(
                (u) =>
                  u.id === s.recordId &&
                  u.lifecycle === "active" &&
                  placeGroupings(place).includes(u.kind),
              ),
            )
            .map((suggestion) => {
              const record = allRecords.find(
                (u) => u.id === suggestion.recordId,
              )!;
              return (
                <div className="suggested-record" key={record.id}>
                  <div className="suggestion-heading">
                    <button
                      className="record-card"
                      onClick={() => openRecord(record.id)}
                    >
                      <span className="record-row-title">
                        {symbols[record.kind]} {record.title}
                      </span>
                    </button>
                    <button
                      disabled={busy}
                      onClick={() =>
                        update(place, {
                          ...placeContent(place),
                          memberIds: [...place.memberIds, record.id],
                        })
                      }
                    >
                      Add to place
                    </button>
                  </div>
                  <details>
                    <summary>Why this record?</summary>
                    {suggestion.connections.map((connection) => (
                      <div className="connection-basis" key={connection.id}>
                        <button onClick={() => openRecord(connection.anchorId)}>
                          {allRecords.find((u) => u.id === connection.anchorId)
                            ?.title ?? "Source record"}
                        </button>
                        <span className="eyebrow">
                          {connection.type} · Accepted connection
                        </span>
                        <p>{connection.justification}</p>
                        {connection.evidence.map((id) => (
                          <button key={id} onClick={() => openRecord(id)}>
                            Evidence:{" "}
                            {allRecords.find((u) => u.id === id)?.title ??
                              "Source record"}
                          </button>
                        ))}
                      </div>
                    ))}
                  </details>
                </div>
              );
            })}
          {!place.suggestions.length && (
            <p className="hint">
              Titan will suggest records here as accepted connections develop.
            </p>
          )}
        </section>
      )}
    </section>
  );
}

export function PlaceDialog({
  place,
  records,
  close,
  save,
}: {
  place?: PlaceView;
  records: NavigationRecord[];
  close: () => void;
  save: (
    content: ReturnType<typeof placeContent>,
    place?: PlaceView,
  ) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState(place?.name ?? "");
  const [type, setType] = useState(place?.type ?? "Project");
  const [custom, setCustom] = useState(
    !["Project", "Team", "Initiative"].includes(type),
  );
  const [organization, setOrganization] = useState<Place["organization"]>(
    place?.organization ?? "assisted",
  );
  const [memberIds, setMembers] = useState(place?.memberIds ?? []);
  const [pinnedIds, setPins] = useState(place?.pinnedIds ?? []);
  const [filter, setFilter] = useState("");
  const [groupings, setGroupings] = useState<PlaceRecordKind[]>([
    ...(place?.groupings ?? placeRecordKinds),
  ]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const available = records.filter(
    (u) => u.lifecycle === "active" || memberIds.includes(u.id),
  );
  const unavailable = memberIds.filter(
    (id) => !available.some((u) => u.id === id),
  );
  function remove(id: string) {
    setMembers(memberIds.filter((member) => member !== id));
    setPins(pinnedIds.filter((pin) => pin !== id));
  }
  return (
    <dialog
      ref={dialog}
      className="place-dialog"
      aria-labelledby="place-dialog-title"
      onCancel={(event) => {
        if (saving) event.preventDefault();
        else close();
      }}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setSaving(true);
          setError("");
          try {
            await save(
              {
                name,
                type,
                organization,
                memberIds,
                pinnedIds,
                groupings: custom ? groupings : undefined,
              },
              place,
            );
            close();
          } catch (error) {
            setError(
              error instanceof Error
                ? error.message
                : "Titan couldn’t save this place. Try again.",
            );
          } finally {
            setSaving(false);
          }
        }}
      >
        <h2 id="place-dialog-title">
          {place ? "Organize place" : "New place"}
        </h2>
        <fieldset disabled={saving}>
          <label>
            Name
            <input
              autoFocus
              required
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            Type
            <select
              value={custom ? "custom" : type}
              onChange={(e) => {
                setCustom(e.target.value === "custom");
                setType(e.target.value === "custom" ? "" : e.target.value);
              }}
            >
              <option>Project</option>
              <option>Team</option>
              <option>Initiative</option>
              <option value="custom">Custom</option>
            </select>
          </label>
          {custom && (
            <label>
              Custom type
              <input
                required
                maxLength={60}
                value={type}
                onChange={(e) => setType(e.target.value)}
              />
            </label>
          )}
          {custom && (
            <div className="place-groupings-field">
              <span id="place-groupings-label">Groupings</span>
              <details className="place-groupings-select">
                <summary aria-labelledby="place-groupings-label place-groupings-value">
                  <span id="place-groupings-value">
                    {groupings.length === 4
                      ? "All groupings"
                      : groupings.map((kind) => labels[kind]).join(", ")}
                  </span>
                  <span aria-hidden="true">▾</span>
                </summary>
                <div
                  className="place-groupings-options"
                  role="group"
                  aria-label="Place groupings"
                >
                  {placeRecordKinds.map((kind) => (
                    <label key={kind}>
                      <input
                        type="checkbox"
                        checked={groupings.includes(kind)}
                        disabled={
                          groupings.length === 1 && groupings.includes(kind)
                        }
                        onChange={(event) =>
                          setGroupings(
                            event.target.checked
                              ? placeRecordKinds.filter(
                                  (item) =>
                                    item === kind || groupings.includes(item),
                                )
                              : groupings.filter((item) => item !== kind),
                          )
                        }
                      />
                      {labels[kind]}
                    </label>
                  ))}
                </div>
              </details>
              <p className="hint">
                Choose which record groupings appear in this place. Keep at
                least one selected.
              </p>
            </div>
          )}
          <label>
            Organization
            <select
              value={organization}
              onChange={(e) =>
                setOrganization(e.target.value as Place["organization"])
              }
            >
              <option value="assisted">Titan-assisted</option>
              <option value="manual">Manual</option>
            </select>
          </label>
          <p className="hint">
            Titan-assisted places suggest records from accepted connections.
            Your pins and order stay as you set them.
          </p>
          <label>
            Find records
            <input
              type="search"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </label>
          <div className="place-record-picker">
            {available
              .filter(
                (u) => !custom || groupings.includes(u.kind as PlaceRecordKind),
              )
              .filter((u) =>
                u.title.toLowerCase().includes(filter.toLowerCase()),
              )
              .map((record) => (
                <label className="place-record-choice" key={record.id}>
                  <input
                    type="checkbox"
                    checked={memberIds.includes(record.id)}
                    onChange={(e) =>
                      e.target.checked
                        ? setMembers([...memberIds, record.id])
                        : remove(record.id)
                    }
                  />
                  <span>
                    {record.title}
                    <small>
                      {labels[record.kind]}
                      {record.lifecycle === "removed" ? " · Removed" : ""}
                    </small>
                  </span>
                </label>
              ))}
            {unavailable.map((id) => (
              <label className="place-record-choice" key={id}>
                <input type="checkbox" checked onChange={() => remove(id)} />
                <span>Unavailable record</span>
              </label>
            ))}
          </div>
          {!!pinnedIds.length && (
            <>
              <h3>Pinned order</h3>
              {pinnedIds.map((id, index) => (
                <div className="pin-order" key={id}>
                  <span>
                    {records.find((u) => u.id === id)?.title ??
                      "Unavailable record"}
                  </span>
                  <button
                    type="button"
                    disabled={index === 0}
                    aria-label={
                      "Move up " +
                      (records.find((u) => u.id === id)?.title ?? "record")
                    }
                    onClick={() => {
                      const next = [...pinnedIds];
                      [next[index - 1], next[index]] = [
                        next[index],
                        next[index - 1],
                      ];
                      setPins(next);
                    }}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    disabled={index === pinnedIds.length - 1}
                    aria-label={
                      "Move down " +
                      (records.find((u) => u.id === id)?.title ?? "record")
                    }
                    onClick={() => {
                      const next = [...pinnedIds];
                      [next[index + 1], next[index]] = [
                        next[index],
                        next[index + 1],
                      ];
                      setPins(next);
                    }}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setPins(pinnedIds.filter((pin) => pin !== id))
                    }
                  >
                    Unpin
                  </button>
                </div>
              ))}
            </>
          )}
        </fieldset>
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
        <div className="button-row">
          <button type="button" disabled={saving} onClick={close}>
            Cancel
          </button>
          <button
            className="primary"
            disabled={saving || !name.trim() || !type.trim()}
          >
            {saving ? "Saving…" : place ? "Save place" : "Create place"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
