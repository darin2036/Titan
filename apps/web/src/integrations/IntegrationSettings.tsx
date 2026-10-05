import React, { useEffect, useState } from "react";
import {
  IntegrationManifestSchema,
  configurationSchema,
  initialValues,
  type IntegrationManifest,
  type IntegrationField,
  type IntegrationValues,
} from "../../../shared/integrations/manifest";
export type Api = (
  path: string,
  method?: string,
  body?: unknown,
) => Promise<any>;
type Entry = { manifest: IntegrationManifest; status: any };
export function IntegrationCatalog({
  api,
  open,
}: {
  api: Api;
  open: (id: string) => void;
}) {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void api("/integrations")
      .then((items: Entry[]) => {
        if (active)
          setEntries(
            items.map((item) => ({
              ...item,
              manifest: IntegrationManifestSchema.parse(item.manifest),
            })),
          );
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [api]);
  return (
    <div className="wide-panel integration-catalog">
      <h2>Integrations</h2>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {!entries && !error && <p role="status">Loading integrations…</p>}
      {entries?.length === 0 && (
        <p className="hint">
          No integrations are available on this deployment.
        </p>
      )}
      <div className="integration-cards">
        {entries?.map(({ manifest, status }) => (
          <button
            key={manifest.id}
            className="integration-card"
            onClick={() => open(manifest.id)}
            aria-label={`Configure ${manifest.name}`}
          >
            <span className="integration-card-header">
              <span className="integration-mark" aria-hidden="true">
                {manifest.name.slice(0, 1)}
              </span>
              <span className="integration-card-identity">
                <strong>{manifest.name}</strong>
                <span>{manifest.category}</span>
              </span>
            </span>
            <span className="integration-card-description">
              {manifest.description}
            </span>
            <span className="integration-card-footer">
              <span
                className={
                  "integration-status" + (status.error ? " attention" : "")
                }
              >
                <span className="integration-status-dot" aria-hidden="true" />
                {status.error
                  ? "Needs attention"
                  : status.connected
                    ? "Connected"
                    : status.authorized
                      ? "Finish setup"
                      : status.configured
                        ? "Not connected"
                        : "Setup required"}
              </span>
              <span className="integration-card-action">
                Configure <span aria-hidden="true">→</span>
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
type Choice = { id: string; name: string; scopes?: string[] };
function ConfigurationFields({
  fields,
  values,
  update,
  api,
  base,
  disabled,
  choicesChanged,
}: {
  fields: IntegrationField[];
  values: IntegrationValues;
  update: (key: string, value: IntegrationValues[string]) => void;
  api: Api;
  base: string;
  disabled: boolean;
  choicesChanged?: (key: string, choices: Choice[]) => void;
}) {
  return (
    <>
      {fields.map((field) => (
        <ConfigurationField
          key={field.key}
          {...{ field, values, update, api, base, disabled, choicesChanged }}
        />
      ))}
    </>
  );
}
function ConfigurationField({
  field,
  values,
  update,
  api,
  base,
  disabled,
  choicesChanged,
}: {
  field: IntegrationField;
  values: IntegrationValues;
  update: (key: string, value: IntegrationValues[string]) => void;
  api: Api;
  base: string;
  disabled: boolean;
  choicesChanged?: (key: string, choices: Choice[]) => void;
}) {
  const [choices, setChoices] = useState<Choice[]>([]),
    [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  const dependency = field.source?.dependsOn
    ? values[field.source.dependsOn]
    : undefined;
  useEffect(() => {
    if (!field.source) return;
    setChoices([]);
    choicesChanged?.(field.key, []);
    setError("");
    if (field.source.dependsOn && !dependency) {
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    const query = field.source.dependsOn
      ? `?${field.source.queryParameter}=${encodeURIComponent(String(dependency))}`
      : "";
    void api(base + field.source.path + query)
      .then((items: Choice[]) => {
        if (active) {
          setChoices(items);
          choicesChanged?.(field.key, items);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [api, base, field, dependency]);
  if (field.source?.dependsOn && !dependency) return null;
  const options =
    field.options ??
    choices.map((choice) => ({ value: choice.id, label: choice.name }));
  const inputId = `integration-field-${field.key}`;
  const control =
    field.type === "boolean" ? (
      <label className="integration-check">
        <input
          type="checkbox"
          disabled={disabled}
          checked={values[field.key] === true}
          onChange={(e) => update(field.key, e.target.checked)}
        />
        {field.label}
      </label>
    ) : field.type === "multiselect" ? (
      <fieldset disabled={disabled || loading}>
        <legend>{field.label}</legend>
        {options.map((option) => (
          <label className="integration-check" key={option.value}>
            <input
              type="checkbox"
              checked={(values[field.key] as string[]).includes(
                String(option.value),
              )}
              onChange={(e) =>
                update(
                  field.key,
                  e.target.checked
                    ? [...(values[field.key] as string[]), String(option.value)]
                    : (values[field.key] as string[]).filter(
                        (id) => id !== String(option.value),
                      ),
                )
              }
            />
            {option.label}
          </label>
        ))}
      </fieldset>
    ) : (
      <label htmlFor={inputId}>
        {field.label}
        {field.type === "select" ? (
          <select
            id={inputId}
            disabled={disabled || loading}
            value={String(values[field.key])}
            required={field.required}
            onChange={(e) =>
              update(
                field.key,
                field.valueType === "number"
                  ? Number(e.target.value)
                  : e.target.value,
              )
            }
          >
            {field.valueType === "string" && (
              <option value="">Choose an option</option>
            )}
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        ) : (
          <input
            id={inputId}
            disabled={disabled}
            required={field.required}
            value={String(values[field.key])}
            type={field.valueType === "number" ? "number" : "text"}
            onChange={(e) =>
              update(
                field.key,
                field.valueType === "number"
                  ? Number(e.target.value)
                  : e.target.value,
              )
            }
          />
        )}
      </label>
    );
  return (
    <div className="integration-field">
      {control}
      {field.description && <p className="hint">{field.description}</p>}
      {loading && (
        <p className="hint" role="status">
          Loading {field.label.toLowerCase()}…
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {field.source && !loading && !error && !options.length && (
        <p className="hint">{field.source.empty}</p>
      )}
    </div>
  );
}
export function IntegrationConfiguration({
  id,
  api,
  refresh,
  back,
}: {
  id: string;
  api: Api;
  refresh: () => Promise<void>;
  back: () => void;
}) {
  const [manifest, setManifest] = useState<IntegrationManifest | null>(null),
    [status, setStatus] = useState<any>(null),
    [values, setValues] = useState<IntegrationValues>({}),
    [authValues, setAuthValues] = useState<IntegrationValues>({});
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [choices, setChoices] = useState<Record<string, Choice[]>>({});
  const base = "/integrations/" + encodeURIComponent(id);
  useEffect(() => {
    let active = true;
    void Promise.all([api(base + "/manifest"), api(base)])
      .then(([raw, state]) => {
        const parsed = IntegrationManifestSchema.parse(raw);
        if (active) {
          setManifest(parsed);
          setStatus(state);
          setValues(initialValues(parsed.configuration.fields, state));
          setAuthValues(initialValues(parsed.auth.options, state));
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    const timer = window.setInterval(() => {
      void api(base)
        .then((state) => {
          if (active) setStatus(state);
        })
        .catch(() => {});
    }, 5000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [api, base]);
  function update(key: string, value: IntegrationValues[string]) {
    setValues((previous) => {
      const next = { ...previous, [key]: value };
      for (const field of manifest!.configuration.fields)
        if (field.source?.dependsOn === key && previous[key] !== value)
          next[field.key] = field.default;
      return next;
    });
  }
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Titan couldn’t update this connection.",
      );
    } finally {
      setBusy(false);
    }
  }
  const authorize = (options: IntegrationValues) =>
    run(async () => {
      const result = await api(base + "/authorize", "POST", options);
      window.location.assign(result.url);
    });
  const missingScope = manifest?.configuration.fields.find(
    (field) =>
      field.requiredScope &&
      values[field.key] === true &&
      !choices[field.requiredScope.field]
        ?.find((choice) => choice.id === values[field.requiredScope!.field])
        ?.scopes?.includes(field.requiredScope.scope),
  );
  const valid =
    manifest &&
    configurationSchema(manifest.configuration.fields).safeParse(values)
      .success;
  return (
    <section className="integration-configuration">
      <button className="breadcrumb-button" onClick={back}>
        ← All integrations
      </button>
      <h1>{manifest?.name ?? "Integration"}</h1>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {!manifest || !status ? (
        !error && <p role="status">Loading connection…</p>
      ) : (
        <>
          <p className="hint">{manifest.description}</p>
          <div
            className="integration-capabilities"
            aria-label="Integration capabilities"
          >
            {manifest.capabilities.map((capability) => (
              <span key={capability}>{capability}</span>
            ))}
          </div>
          {!status.configured && (
            <p className="notice">{status.setupIssue ?? manifest.auth.setup}</p>
          )}
          <div className="integration-section">
            <h2>Connection</h2>
            <p>
              {status.connected
                ? "Connected"
                : status.authorized
                  ? "Authorized · Choose what to include below"
                  : "Not connected"}
              {status.accountLabel ? ` · ${status.accountLabel}` : ""}
            </p>
            {status.connected && (
              <p className="hint">
                {status.syncing
                  ? "Syncing…"
                  : status.lastSync
                    ? "Last synced " +
                      new Date(status.lastSync).toLocaleString()
                    : "Waiting for the first sync"}
                {typeof status.pages === "number" &&
                  ` · ${status.pages} connected ${status.pages === 1 ? "page" : "pages"}`}
              </p>
            )}
            {status.error && (
              <p className="notice" role="status">
                {status.error}
              </p>
            )}
            {!status.authorized ? (
              <>
                <ConfigurationFields
                  fields={manifest.auth.options}
                  values={authValues}
                  update={(key, value) =>
                    setAuthValues((v) => ({ ...v, [key]: value }))
                  }
                  {...{ api, base }}
                  disabled={busy}
                />
                <button
                  className="primary"
                  disabled={busy || !status.configured}
                  onClick={() => void authorize(authValues)}
                >
                  {manifest.auth.label}
                </button>
              </>
            ) : (
              <div className="button-row">
                {manifest.actions.sync && status.connected && (
                  <button
                    disabled={busy || status.syncing}
                    onClick={() =>
                      void run(async () => {
                        setStatus(await api(base + "/sync", "POST", {}));
                        setNotice(
                          "Sync queued. Connected content will refresh in the background.",
                        );
                      })
                    }
                  >
                    Sync now
                  </button>
                )}
                <button
                  disabled={busy}
                  onClick={() =>
                    void authorize(
                      Object.fromEntries(
                        manifest.auth.options.map((field) => [
                          field.key,
                          values[field.key] ?? authValues[field.key],
                        ]),
                      ),
                    )
                  }
                >
                  Reconnect
                </button>
                <button
                  disabled={busy}
                  onClick={() => setConfirmDisconnect(true)}
                >
                  Disconnect
                </button>
              </div>
            )}
          </div>
          {status.authorized && (
            <form
              className="integration-section"
              onSubmit={(event) => {
                event.preventDefault();
                void run(async () => {
                  setStatus(
                    await api(
                      base,
                      "PUT",
                      configurationSchema(manifest.configuration.fields).parse(
                        values,
                      ),
                    ),
                  );
                  await refresh();
                  setNotice(manifest.configuration.savedMessage);
                });
              }}
            >
              <h2>Configuration</h2>
              <ConfigurationFields
                fields={manifest.configuration.fields.filter(
                  (f) => !f.advanced,
                )}
                {...{ values, update, api, base }}
                disabled={busy}
                choicesChanged={(key, items) =>
                  setChoices((previous) => ({ ...previous, [key]: items }))
                }
              />
              {missingScope && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void authorize(
                      Object.fromEntries(
                        manifest.auth.options.map((field) => [
                          field.key,
                          values[field.key] ?? field.default,
                        ]),
                      ),
                    )
                  }
                >
                  Update authorization
                </button>
              )}
              {manifest.configuration.fields.some((f) => f.advanced) && (
                <details>
                  <summary>Advanced</summary>
                  <ConfigurationFields
                    fields={manifest.configuration.fields.filter(
                      (f) => f.advanced,
                    )}
                    {...{ values, update, api, base }}
                    disabled={busy}
                  />
                </details>
              )}
              {manifest.configuration.description && (
                <p className="hint">{manifest.configuration.description}</p>
              )}
              <button
                className="primary"
                disabled={busy || !valid || !!missingScope}
              >
                {manifest.configuration.saveLabel}
              </button>
            </form>
          )}
          {confirmDisconnect && (
            <div
              className="notice"
              role="group"
              aria-label="Confirm disconnection"
            >
              <p>{manifest.actions.disconnectMessage}</p>
              <div className="button-row">
                <button
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const state = await api(base, "DELETE");
                      setStatus(state);
                      setValues(
                        initialValues(manifest.configuration.fields, state),
                      );
                      setAuthValues(
                        initialValues(manifest.auth.options, state),
                      );
                      setConfirmDisconnect(false);
                      await refresh();
                    })
                  }
                >
                  Disconnect {manifest.name}
                </button>
                <button
                  disabled={busy}
                  onClick={() => setConfirmDisconnect(false)}
                >
                  Keep connection
                </button>
              </div>
            </div>
          )}
          <details className="integration-section">
            <summary>Connection details</summary>
            <p className="hint">{manifest.auth.details}</p>
          </details>
        </>
      )}
    </section>
  );
}
