import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { IntegrationRegistry } from "../apps/server/src/integrations.ts";
import {
  IntegrationManifestSchema,
  configurationSchema,
  initialValues,
} from "../apps/shared/integrations/manifest.ts";
import { confluenceManifest } from "../apps/shared/integrations/confluence.ts";
import { createApp } from "../apps/server/src/api.ts";
test("a second integration uses the registry contract with isolated manifest validation and handlers", () => {
  const manifest = IntegrationManifestSchema.parse({
    ...confluenceManifest,
    id: "sample",
    name: "Sample source",
    auth: { ...confluenceManifest.auth, options: [] },
    configuration: {
      saveLabel: "Save",
      savedMessage: "Saved",
      fields: [
        {
          key: "collection",
          label: "Collection",
          type: "text",
          default: "",
          required: true,
        },
        { key: "enabled", label: "Enabled", type: "boolean", default: false },
      ],
    },
    actions: { sync: false, disconnectMessage: "Disconnect this source." },
  });
  const registry = new IntegrationRegistry();
  let configured: unknown;
  registry.register({
    manifest,
    status: () => ({ configured: true, authorized: true, connected: false }),
    authorize: () => ({ url: "https://example.com" }),
    configure: (values) => {
      configured = values;
    },
    disconnect: () => ({ connected: false }),
  });
  assert.equal(registry.catalog()[0].manifest.name, "Sample source");
  registry.configure("sample", { collection: "Team" });
  assert.deepEqual(configured, { collection: "Team", enabled: false });
  assert.throws(() =>
    registry.configure("sample", { collection: "Team", accessToken: "secret" }),
  );
  assert.throws(() => registry.configure("sample", {}));
  assert.throws(() => registry.configure("sample", { collection: "" }));
  assert.throws(() => registry.get("missing"));
  assert.throws(() => registry.register(registry.get("sample")), /Duplicate/);
  assert.throws(
    () =>
      registry.register({
        ...registry.get("sample"),
        manifest: {
          ...manifest,
          id: "invalid",
          actions: { ...manifest.actions, sync: true },
        },
      }),
    /handler/,
  );
});
test("Confluence manifest restores typed values and rejects unsupported choices, duplicate fields and broken dependencies", () => {
  const values = initialValues(confluenceManifest.configuration.fields, {
    site: { id: "cloud" },
    spaces: ["7"],
    allowEdits: true,
    intervalMinutes: 10,
  });
  assert.deepEqual(values, {
    siteId: "cloud",
    spaces: ["7"],
    allowEdits: true,
    intervalMinutes: 10,
  });
  const schema = configurationSchema(confluenceManifest.configuration.fields);
  assert.ok(schema.safeParse(values).success);
  const multiple = IntegrationManifestSchema.parse({
    ...confluenceManifest,
    configuration: {
      ...confluenceManifest.configuration,
      fields: [
        {
          key: "topics",
          label: "Topics",
          type: "multiselect",
          default: [],
          options: [{ value: "team", label: "Team" }],
        },
      ],
    },
  });
  const choices = configurationSchema(multiple.configuration.fields);
  assert.ok(choices.safeParse({ topics: ["team"] }).success);
  assert.ok(!choices.safeParse({ topics: ["unlisted"] }).success);
  assert.ok(!schema.safeParse({ ...values, intervalMinutes: 20 }).success);
  assert.ok(!schema.safeParse({ ...values, intervalMinutes: "5" }).success);
  assert.ok(!schema.safeParse({ ...values, spaces: [] }).success);
  assert.ok(
    !IntegrationManifestSchema.safeParse({
      ...confluenceManifest,
      manifestVersion: 2,
    }).success,
  );
  assert.ok(
    !IntegrationManifestSchema.safeParse({
      ...confluenceManifest,
      configuration: {
        ...confluenceManifest.configuration,
        fields: [
          ...confluenceManifest.configuration.fields,
          confluenceManifest.configuration.fields[0],
        ],
      },
    }).success,
  );
  assert.ok(
    !IntegrationManifestSchema.safeParse({
      ...confluenceManifest,
      configuration: {
        ...confluenceManifest.configuration,
        fields: [
          {
            ...confluenceManifest.configuration.fields[1],
            source: {
              path: "/spaces",
              dependsOn: "missing",
              queryParameter: "siteId",
              empty: "None",
            },
          },
        ],
      },
    }).success,
  );
});
test("integration discovery is owner-only, public manifests contain no credentials, and unknown providers return 404", async () => {
  const dir = mkdtempSync(join(tmpdir(), "titan-plugins-"));
  const instance = createApp({
    workspace: join(dir, "repo"),
    stateDir: join(dir, "state"),
    ownerToken: "test-owner",
    workers: false,
    confluence: { clientId: "private-id", clientSecret: "private-secret" },
  });
  try {
    const headers = { authorization: "Bearer test-owner" };
    assert.equal(
      (await instance.app.inject({ url: "/api/v1/integrations" })).statusCode,
      401,
    );
    const catalog = await instance.app.inject({
      url: "/api/v1/integrations",
      headers,
    });
    assert.equal(catalog.statusCode, 200);
    assert.equal(catalog.json()[0].manifest.id, "confluence");
    assert.ok(!catalog.body.includes("private-secret"));
    const manifest = await instance.app.inject({
      url: "/api/v1/integrations/confluence/manifest",
      headers,
    });
    assert.equal(manifest.statusCode, 200);
    assert.deepEqual(manifest.json(), confluenceManifest);
    assert.equal(
      (
        await instance.app.inject({
          url: "/api/v1/integrations/missing/manifest",
          headers,
        })
      ).statusCode,
      404,
    );
    const issued = await instance.app.inject({
      method: "POST",
      url: "/api/v1/tokens",
      headers,
      payload: { scopes: ["read"] },
    });
    assert.equal(issued.statusCode, 200);
    const token = issued.json().token;
    assert.equal(
      (
        await instance.app.inject({
          url: "/api/v1/integrations",
          headers: { authorization: "Bearer " + token },
        })
      ).statusCode,
      403,
    );
  } finally {
    await instance.app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
