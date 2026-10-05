import React, { useEffect, useState } from "react";
type Api = (path: string, method?: string, body?: unknown) => Promise<any>;
export function ConfluenceSource({
  source,
  recordId,
  api,
  refresh,
}: {
  source: any;
  recordId: string;
  api: Api;
  refresh: () => Promise<void>;
}) {
  const [preview, setPreview] = useState<any>(null);
  const [remote, setRemote] = useState<any>(null);
  useEffect(() => {
    let active = true;
    const load = () =>
      void api(`/units/${recordId}/confluence/source`)
        .then((value) => {
          if (active) setRemote(value);
        })
        .catch(() => {});
    load();
    const timer = window.setInterval(load, 5000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [api, recordId, source.version]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Titan couldn’t update this page.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="record-details confluence-source">
      <summary>
        {source.owner === "titan" ? "Moved from Confluence" : "Confluence"} ·
        Source version {source.version}
      </summary>
      <div className="button-row">
        <a href={source.url} target="_blank" rel="noreferrer">
          Open in Confluence
        </a>
        {source.owner === "confluence" && (
          <>
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await api(
                    `/units/${recordId}/confluence/refresh`,
                    "POST",
                    {},
                  );
                  setPreview(null);
                  await refresh();
                })
              }
            >
              Refresh source
            </button>
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  setPreview(
                    await api(`/units/${recordId}/confluence/migration`),
                  );
                })
              }
            >
              Move to Titan
            </button>
          </>
        )}
      </div>
      {source.owner === "titan" &&
        remote?.latestObservedVersion > source.version && (
          <p className="notice">
            Titan last observed a newer Confluence source version (
            {remote.latestObservedVersion}). Titan’s content remains the version
            you moved. Open the original to compare changes.
          </p>
        )}
      {!!source.issues?.length && (
        <p className="notice">
          {source.issues.join(". ")}. The original is preserved in Confluence.
          Editing and migration are paused to protect that content.
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {preview && (
        <div className="notice">
          <p>
            Move “{preview.title}” to Titan with its {preview.connections}{" "}
            {preview.connections === 1 ? "connection" : "connections"} and
            history. Its original Confluence page stays in place. The migrated
            content will join your Markdown repository and can be published with
            it.
          </p>
          {!!preview.issues.length && <p>{preview.issues.join(". ")}</p>}
          <div className="button-row">
            <button
              disabled={busy || !preview.canMove}
              onClick={() =>
                void run(async () => {
                  await api(`/units/${recordId}/confluence/migration`, "POST", {
                    revision: preview.revision,
                  });
                  setPreview(null);
                  await refresh();
                })
              }
            >
              Move this page
            </button>
            <button disabled={busy} onClick={() => setPreview(null)}>
              Keep in Confluence
            </button>
          </div>
        </div>
      )}
    </details>
  );
}
