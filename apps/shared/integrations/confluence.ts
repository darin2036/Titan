import { IntegrationManifestSchema } from "./manifest.ts";
export const confluenceManifest = IntegrationManifestSchema.parse({
  manifestVersion: 1,
  id: "confluence",
  name: "Confluence",
  version: "1.0.0",
  category: "Knowledge sources",
  description:
    "Connect Confluence pages to Titan’s search, knowledge connections, and reliability signals.",
  capabilities: ["Read pages", "Optional write-back", "Move pages to Titan"],
  auth: {
    type: "oauth2",
    label: "Connect Confluence",
    options: [
      {
        key: "allowEdits",
        label: "Allow edits to Confluence",
        type: "boolean",
        default: false,
      },
    ],
    setup:
      "Confluence needs operator setup. Add the Titan OAuth app credentials and callback address to the server configuration.",
    details:
      "This connection uses the owner’s Confluence access. Titan’s current workspace is for one owner; organization-wide access needs individual permission checks.",
  },
  configuration: {
    saveLabel: "Save connection",
    savedMessage: "Saved. Titan is adding pages from your selected spaces.",
    description:
      "Selected pages are cached privately on this deployment and included in Titan’s search and agent context.",
    fields: [
      {
        key: "siteId",
        label: "Confluence site",
        type: "select",
        required: true,
        default: "",
        initialPath: "site.id",
        source: {
          path: "/sites",
          empty:
            "No Confluence sites are available to this account. Reconnect with an account that can access a site.",
        },
      },
      {
        key: "spaces",
        label: "Spaces to include",
        type: "multiselect",
        required: true,
        default: [],
        source: {
          path: "/spaces",
          dependsOn: "siteId",
          queryParameter: "siteId",
          empty: "No spaces are available to this account in this site.",
        },
      },
      {
        key: "allowEdits",
        label: "Allow edits to Confluence",
        type: "boolean",
        default: false,
        requiredScope: { field: "siteId", scope: "write:page:confluence" },
      },
      {
        key: "intervalMinutes",
        label: "Sync frequency",
        type: "select",
        valueType: "number",
        default: 5,
        advanced: true,
        options: [
          { value: 1, label: "Every minute" },
          { value: 5, label: "Every 5 minutes" },
          { value: 10, label: "Every 10 minutes" },
        ],
      },
    ],
  },
  actions: {
    sync: true,
    disconnectMessage:
      "Disconnecting removes connected pages from search and agent context. Pages you moved to Titan stay available. Private connection history stays on this deployment.",
  },
});
