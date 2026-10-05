import { useEffect, useState } from "react";
import { recordTypeLabels } from "./record-presentation";
type DocumentFile = { path: string; id: string; title: string; kind: string };
export default function DocumentsBrowser({
  api,
  openRecord,
}: {
  api: (path: string) => Promise<any>;
  openRecord: (id: string) => void;
}) {
  const [files, setFiles] = useState<DocumentFile[]>([]);
  const [folder, setFolder] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    api("/documents")
      .then((result) => {
        if (active) setFiles(result);
      })
      .catch((error) => {
        if (active)
          setError(
            error instanceof Error
              ? error.message
              : "Titan couldn’t load the documents. Try again.",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [api, reload]);
  const searching = !!query.trim();
  const prefix = folder ? folder + "/" : "";
  const scoped = files.filter((file) => file.path.startsWith(prefix));
  const folders = [
    ...new Set(
      scoped
        .map((file) => file.path.slice(prefix.length))
        .filter((path) => path.includes("/"))
        .map((path) => path.split("/")[0]),
    ),
  ].sort();
  const documents = scoped.filter((file) =>
    searching
      ? (file.title + " " + file.path)
          .toLowerCase()
          .includes(query.trim().toLowerCase())
      : !file.path.slice(prefix.length).includes("/"),
  );
  return (
    <section className="documents-browser" aria-label="Document files">
      <div className="documents-browser-toolbar">
        <nav className="document-folders" aria-label="Document folders">
          <button
            onClick={() => {
              setFolder("");
              setQuery("");
            }}
            aria-current={!folder ? "location" : undefined}
          >
            Document root
          </button>
          {folder
            .split("/")
            .filter(Boolean)
            .map((part, index, parts) => (
              <span key={index}>
                <span aria-hidden="true">/</span>
                <button
                  onClick={() => {
                    setFolder(parts.slice(0, index + 1).join("/"));
                    setQuery("");
                  }}
                  aria-current={
                    index === parts.length - 1 ? "location" : undefined
                  }
                >
                  {part}
                </button>
              </span>
            ))}
        </nav>
        <input
          type="search"
          aria-label="Find document files"
          placeholder="Find documents"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      {loading ? (
        <p role="status">Loading documents…</p>
      ) : error ? (
        <div role="alert">
          <p>{error}</p>
          <button onClick={() => setReload((value) => value + 1)}>
            Try again
          </button>
        </div>
      ) : (
        <>
          {!searching &&
            folders.map((name) => (
              <button
                className="document-file-row"
                key={name}
                onClick={() => setFolder(prefix + name)}
              >
                <span aria-hidden="true">▱</span>
                <span>{name}</span>
                <small>Folder</small>
              </button>
            ))}
          {documents.map((file) => (
            <button
              className="document-file-row"
              key={file.path}
              onClick={() => openRecord(file.id)}
            >
              <span aria-hidden="true">▤</span>
              <span className="document-file-name">
                {file.title}
                <small>
                  {searching ? file.path : file.path.slice(prefix.length)}
                </small>
              </span>
              <small>{recordTypeLabels[file.kind] ?? file.kind}</small>
            </button>
          ))}
          {!documents.length && (searching || !folders.length) && (
            <p role="status">
              {searching
                ? "No matching documents."
                : "No documents in this folder yet."}
            </p>
          )}
        </>
      )}
    </section>
  );
}
