import {
  IntegrationManifestSchema,
  configurationSchema,
  type IntegrationManifest,
  type IntegrationValues,
} from "../../shared/integrations/manifest.ts";
import { demand } from "./contracts.ts";
export type IntegrationStatus = {
  configured: boolean;
  authorized: boolean;
  connected: boolean;
  accountLabel?: string;
  error?: string | null;
  [key: string]: unknown;
};
export type IntegrationPlugin = {
  manifest: IntegrationManifest;
  status: () => IntegrationStatus;
  authorize: (options: IntegrationValues) => unknown;
  configure: (values: IntegrationValues) => unknown;
  disconnect: () => unknown;
  sync?: () => unknown;
  choices?: Record<string, (query: Record<string, string>) => unknown>;
};
/** Trusted, bundled integrations. Manifests are data; provider code stays server-side. */
export class IntegrationRegistry {
  private plugins = new Map<string, IntegrationPlugin>();
  register(plugin: IntegrationPlugin) {
    const manifest = IntegrationManifestSchema.parse(plugin.manifest);
    if (this.plugins.has(manifest.id))
      throw new Error("Duplicate integration: " + manifest.id);
    if (manifest.actions.sync && !plugin.sync)
      throw new Error("Integration declares sync without a handler");
    for (const field of manifest.configuration.fields)
      if (field.source && !plugin.choices?.[field.source.path])
        throw new Error(
          "Integration choice source has no handler: " + field.key,
        );
    this.plugins.set(manifest.id, { ...plugin, manifest });
  }
  get(id: string) {
    const plugin = this.plugins.get(id);
    demand(plugin, 404, "This integration isn’t available.");
    return plugin;
  }
  catalog() {
    return [...this.plugins.values()].map(({ manifest, status }) => ({
      manifest,
      status: status(),
    }));
  }
  manifest(id: string) {
    return this.get(id).manifest;
  }
  configure(id: string, input: unknown) {
    const plugin = this.get(id);
    return plugin.configure(
      configurationSchema(plugin.manifest.configuration.fields).parse(
        input,
      ) as IntegrationValues,
    );
  }
  authorize(id: string, input: unknown) {
    const plugin = this.get(id);
    return plugin.authorize(
      configurationSchema(plugin.manifest.auth.options).parse(
        input,
      ) as IntegrationValues,
    );
  }
  choices(id: string, source: string, query: Record<string, string>) {
    const handler = this.get(id).choices?.["/" + source];
    demand(handler, 404, "These integration choices aren’t available.");
    return handler(query);
  }
}
