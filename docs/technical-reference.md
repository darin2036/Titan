# Titan technical reference

This document describes the current implementation and integration contracts. Run commands from the repository root. For installation and the demo, see [the README](../README.md).

## Architecture

```text
React workspace ─┐
HTTP / MCP ──────┼─ TypeScript domain engine ─ Git storage adapter
External outcomes┘          │                        │
                            │                  Markdown + durable events
                      persisted jobs
                            │
                    Python intelligence
                 inference / embeddings / ranking
                            │
                    structured proposals
                            │
                   domain policy + review
```

- `apps/server/src`: shared contracts, domain operations, Git storage, SQLite indexes/queues, HTTP, and MCP.
- `services/intelligence`: Python HTTP service, provider adapters, deterministic evaluation, and future training interface. It has no repository mutation access.
- `apps/web`: document navigation, conversational drafts, relationship inspection, reviews, provenance, and learning controls.
- `tests`: storage, policy, retention, authentication, webhooks, and real Python/HTTP/MCP integration.

The domain engine is the only application mutation authority. Revision-aware operations reject stale work. Removed content cannot enter agent context. ML ranking cannot override access, applicability, or validity rules.

## Durable record format

Records live under `records/`. JSON is used inside Markdown frontmatter to avoid ambiguous YAML coercion. IDs survive renaming; revision hashes reflect exact file contents. Standard headers include kind, lifecycle, workflow status, validity, authority, applicability, and schema version.

<!-- prettier-ignore -->
```markdown
---
{
  "schemaVersion": 1,
  "id": "11111111-1111-4111-8111-111111111111",
  "kind": "knowledge",
  "title": "Production authentication",
  "lifecycle": "active",
  "status": "draft",
  "validity": "unverified",
  "authority": "hypothesis",
  "applicability": ["production"],
  "createdAt": "2026-10-05T00:00:00.000Z",
  "updatedAt": "2026-10-05T00:00:00.000Z",
  "extensions": {}
}
---

## Claim

Production services use short-lived workload identity.
```

Namespaced extensions allow future features. Derived summaries should include `extensions["titan:sources"]`, a map from source UUIDs to exact revisions. Such summaries are excluded from agent reads and search if a source is missing, removed, or revised. They must be regenerated with fresh provenance.

`.titan/` holds workspace policy, configurable relationship types, assertions, reviews, events, jobs, feedback, dataset manifests, and model descriptors. These records travel with the repository. SQLite projections and large model artifacts stay in local state outside the knowledge repository.

### Places and navigation

Places live in `.titan/places/<id>.json` and travel with the workspace. Each place has a user-defined name and type, explicit record membership, an ordered set of pinned record IDs, and manual or Titan-assisted organization. Records can appear in multiple places without copying their content. Owner-only `GET/POST /api/v1/places` and revision-checked `PUT /api/v1/places/:id` manage organization separately from record applicability and permissions.

Assisted places suggest directly connected records only through accepted assertions whose endpoints and evidence still match their recorded revisions. Suggestions expose the connection basis and do not change membership or pinned order until the owner adds a record. Removed records keep their saved membership but are hidden from navigation. Place-based `/api/v1/author` requests use eligible member records, return exact source revisions, and refuse a source change during drafting. Published overviews retain `titan:sources` provenance and follow existing source invalidation rules. The fixture provider produces a labeled source outline rather than a model-generated synthesis.

The web UI uses one resizable primary panel and a shared canvas for browsing, place overviews, reading, and editing. Navigation width and the last location are browser-local preferences; the last location and unpublished drafts’ place context are scoped to the workspace root. Narrow screens use a navigation disclosure.

Transactions stage only their own change set and refuse to operate over pre-existing staged changes. A recovery journal inside Git metadata rolls back an interrupted uncommitted change set. Publication explicitly pushes to `titan/workspace`, refuses divergent histories, and never force-pushes.

## Human page composition

The web composer uses owner-only `/api/v1/composer-drafts` endpoints. Drafts live in a dedicated `composer_drafts` table in the workspace’s local SQLite state. They survive restart and reindexing, remain separate from records, and never enter search, agent context, inference jobs, Git history, or workspace branch publication. Back up local state to preserve unpublished drafts; they are not rebuildable projections. Drafts are scoped to the connected repository and are not shared across devices.

- `GET /composer-drafts` lists unpublished drafts.
- `PUT /composer-drafts/:id` saves `{ version, content }`; version zero creates a draft and subsequent writes require the exact current version. Content includes kind, title, body, applicability, and a nullable source `{ id, revision }`.
- `POST /composer-drafts/:id/publish` publishes the exact saved version. New pages receive the draft’s stable ID and normal default validity and authority. Existing pages retain their identity and metadata, except the explicitly edited title, body, applicability, and publication marker. Published knowledge uses the normal record lifecycle/status contract; publication does not establish verification or approval.
- `POST /composer-drafts/:id/rebase` takes `{ version, revision }` after a human compares the latest page. It updates the draft’s source revision without publishing or changing its content. A changed source revision is checked again at publication.
- `DELETE /composer-drafts/:id` discards an unpublished version without changing any published page.

Publication runs through the domain engine’s existing revision-aware record operations, writes Markdown and human provenance to Git, indexes the result, and queues normal relationship inference. It does not wait for AI inference or rewrite the body. A durable `titan:composer` extension plus a local receipt makes publication retries safe if a process stops after the Git commit. Applicability helps retrieval; it is not an audience access-control list. The current single-owner permission model still applies.

The browser debounces autosave, serializes saves, flushes changes before navigation, and warns before unloading unsaved content. A lazy-loaded Tiptap rich-text editor renders headings, inline marks, lists, quotes, code, links, checklists, and GFM tables in place. The composer provides an open page canvas with an optional inline title and audience details behind a disclosure. Formatting appears on text selection or through a searchable `~ ` command menu; arrow keys navigate, Enter applies, and Escape dismisses. Markdown input and paste shortcuts and platform keyboard shortcuts apply formatting immediately. Editor updates serialize to Markdown; opening an existing draft does not rewrite its body, while editing can normalize Markdown syntax without changing the written content. Underline is stored with `<u>` tags. Read views recognize a small set of exact inline formatting tags without enabling arbitrary HTML, including attributes or scripts. Stale draft writes and stale source revisions preserve the draft for review rather than overwriting newer work.

## Agent integration

Create a scoped integration token in Settings. Tokens are stored hashed in local state and are not copied into the knowledge repository. Both HTTP and MCP use the same domain rules.

```sh
export TITAN_AGENT_TOKEN=...
npm --silent run mcp
```

Configure your MCP client to launch `npm --silent run mcp` in this checkout with `TITAN_AGENT_TOKEN`. The client must have the local API running. Optional `TITAN_API_URL` changes its API destination.

MCP tools: `search_context`, `read_unit`, `create_unit`, `revise_unit`, `establish_relationship`, `remove_unit`, `record_outcome`, and `record_feedback`.

HTTP endpoints use `/api/v1` and `Authorization: Bearer TOKEN`:

| Endpoint                                             | Purpose                                                                                 |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `POST /context`                                      | Query plus optional applicability scope; exact revisions and validity warnings returned |
| `GET/POST /units`                                    | Read active units or create a structured unit                                           |
| `GET/PATCH /units/:id`                               | Read or revise using `revision` and a validated `patch`                                 |
| `POST /units/:id/remove`                             | Soft removal using revision and justification                                           |
| `POST /units/:id/restore`                            | Human-only restoration                                                                  |
| `GET /units/:id/history`                             | Revision history, gated by current retention state                                      |
| `GET/POST /relationships`                            | Inspect or establish typed, evidenced relationships                                     |
| `GET /reviews`, `POST /reviews/:id`                  | Owner review with `accept: true/false`                                                  |
| `POST /outcomes`                                     | Idempotent external evidence using event ID and work revision                           |
| `POST /feedback`                                     | Distinct feedback signals with source provenance                                        |
| `POST /datasets`                                     | Capture a deployment-local dataset manifest                                             |
| `POST /models/evaluate`                              | Evaluate a baseline ranking candidate                                                   |
| `POST /models/:id/activate`, `POST /models/rollback` | Owner-controlled intelligence versions                                                  |

Agent history and audit reads cannot expose currently removed records. A reported test result does not automatically verify evidence or complete work. Completion currently requires accepted supporting evidence with supported validity and human acceptance in bounded mode. Automated PR merge verification is a future policy extension.

## External coding workflows

Set a webhook URL in Settings and `TITAN_WEBHOOK_SECRET` in the launcher environment. An authorized transition into `ready` queues `work.ready` with an event ID, work ID, exact revision, and context references. The product does not launch coding agents.

Receivers verify `X-Titan-Signature`: hexadecimal HMAC-SHA256 of `X-Titan-Timestamp + "." + rawBody`. Verify timestamp freshness and deduplicate the payload's `eventId`; retries reuse it. `X-Titan-Event` identifies the delivery job. Delivery retries three times with exponential backoff. Redirects are rejected. Queue state and errors are visible in Settings.

External workflows submit `/outcomes` with `eventId`, `workId`, `revision`, `title`, `body`, and optional `verified`. The `verified` field describes what the external workflow reported; it cannot elevate evidence to verified organizational knowledge.

All listeners bind to loopback. Remote workflows need user-managed connectivity. This release is not a public internet service.

## Learning and retention boundaries

Feedback datasets and artifacts are deployment-local. Dataset manifests preserve label identity, source revisions, author identity, and label provenance. Candidate descriptors include artifact checksums, configuration, and evaluation results. Activation and rollback are human-only; ranking falls back to the baseline if a candidate references removed sources.

The evaluator currently tests four deterministic retrieval safety scenarios. Passing them demonstrates those invariants, not learned relevance quality. `TrainingInterface` is deliberately unimplemented: there is no custom training, fine-tuning, or cross-deployment learning yet.

Removal is recoverable and distinct from supersession. Removal invalidates derived indexes and source-bound summaries and queues artifact reevaluation. Restoration does not revive old relationships or establish validity. Irreversible purge is absent. Direct Git access and copies already delivered to external agents remain outside app enforcement.

## Verification

`npm run check` runs strict TypeScript checking, a production UI build, Node behavior/integration tests, and Python tests. The integration test starts Python and exercises an actual MCP client. No paid model calls occur. Provider adapters are tested with mocked responses; live account/model availability and authenticated GitHub connectivity require your environment.

### Document identity and record signals

The document title is the primary heading in reading and writing views. Its supporting row reflects the persisted record type, validity, and update time; unpublished drafts are labeled separately. New record-write audit events include `resultingRevisions`, binding the acting principal to the saved content hash while retaining the input `revisions` used for conflict checks. Editor attribution only appears when an applied event identifies the current resulting revision (or a legacy creation event identifies that original revision). External changes and older edits without this binding show the update time without guessing an editor. Validity remains distinct from recency, authority, and workflow status.

Future records-management classification should be structured, policy-versioned metadata with provenance and human review where required. Classification, retention rules, legal holds, sensitivity, and compliance control mappings should remain distinct from knowledge validity. AI can propose classifications and mappings with supporting evidence; policy enforcement needs explicit lifecycle and permission rules before it can make compliance claims. These controls are not implemented by the document metadata row.

### Revision-bound reliability assessment

Record headers expose a reliability assessment with an expandable **View basis** disclosure. The shared `revision-basis-v1` evaluator runs in both the browser and server. It reports Supported, Needs review, Disputed, Superseded, or Not yet assessed, with reasons and the exact record revision. This is an explanation of recorded support, not a calibrated accuracy percentage or a substitute for retrieval ranking.

Support requires an incoming accepted `supports` relationship bound to current, available revisions. Supporting records and explicit evidence must have supported validity and observed or approved authority. Scoped evidence requires a matching selected context. Upstream accepted support must also remain current and usable; support cycles and unresolved upstream conflicts cannot establish downstream support. Proposed connections never establish support. Accepted relationships with changed or unavailable revisions require review; derived records also require all transitive `titan:sources` dependencies to remain available at their recorded revisions. Recorded disputed or superseded validity takes precedence; possible conflicts and replacements require review. A supported validity label by itself cannot establish a current supporting basis.

The disclosure shows applicability, recorded validity and authority, relationship justifications, assessed evidence revisions, and links to available evidence or replacement records. Unavailable records do not expose their titles or offer navigation. No timestamp claims that a human or model verified correctness: the assessment is recomputed from the available snapshot without writing a new record revision.

Authenticated readers can request `GET /api/v1/units/:id/reliability?scope=production` (optional single applicability scope). Agent context results include the same `reliability` object, with the existing multi-scope context selection. The existing `usableAsBasis` field remains a validity-based retrieval guard and excludes partially converted Confluence pages; it does not mean that an unverified record has established support. Connected Confluence pages use the same evaluator; source version changes produce new observed Titan revisions and invalidate earlier revision-bound support.

The page header has one contextual action row alongside its breadcrumb: creation actions in the overview, edit and agent actions while reading, and publish/close while composing. Draft actions render into the same header host while retaining the composer’s save queue and action guards. Secondary actions use a keyboard-accessible overflow menu; closing flushes pending draft edits before navigating.

### Integration plugins and configuration

Settings has its own section navigation for Integrations, Repository, Intelligence & autonomy, Agent access, and Background operations. Sections have reloadable `#settings/<section>` routes and retain browser back navigation. On narrow screens, the section navigation becomes a horizontally scrollable row. The integration catalog presents manifest identity, category, description, connection status, and a configuration action in compact cards. Each integration has a dedicated configuration route at `#settings/integrations/<id>`. OAuth returns open the provider’s configuration screen. Reloading and browser back restore the screen; provider forms are kept out of the main Settings overview.

Bundled integration plugins pair a versioned public manifest with a trusted server adapter. `apps/shared/integrations/manifest.ts` defines and validates the manifest contract. Each manifest declares identity, capabilities, OAuth options, configuration fields, default values, optional advanced fields, dynamic choice sources and dependencies, permission requirements, and action copy. The same field definitions validate configuration on the server and drive the shared React renderer. Supported controls are text, boolean, select, and multiple selection; select values retain their declared string or number type. Operator credentials are never manifest fields or public configuration.

To add an integration:

1. Add a manifest under `apps/shared/integrations/` using `IntegrationManifestSchema` and a stable provider ID.
2. Implement a server adapter with `status`, `authorize`, `configure`, and `disconnect`, plus optional `sync` and choice-source handlers. Register it with `IntegrationRegistry` in `createApp`. Register provider-specific OAuth callbacks and content operations separately.
3. Keep credentials and provider authorization checks in the adapter. Configuration schemas check shape and static choices; the adapter also checks dynamic resource access and scopes.

The catalog and configuration renderer need no provider-specific additions for supported fields. Registry registration rejects duplicate IDs, unsupported manifest versions, invalid dependencies, and declared actions or choice sources without handlers. Discovery and configuration routes require the owner. The registry exposes GET `/api/v1/integrations`, GET `/api/v1/integrations/:id/manifest`, GET/PUT/DELETE `/api/v1/integrations/:id`, POST `/authorize` and `/sync`, and GET choice-source paths beneath the integration. Provider status supplies the common `configured`, `authorized`, and `connected` flags and optional `accountLabel`, sync, count, and error details, plus public values used to restore the form. Status polling preserves unsaved selections.

This is a bundled plugin contract with OAuth support, not an arbitrary code loader or marketplace. New authentication methods or control types extend the shared contract and renderer. Confluence is its first implementation. The separation of schema, public configuration, and backend secrets follows [Backstage’s plugin configuration guidance](https://backstage.io/docs/conf/defining/).

### Confluence Cloud connection

Settings → Integrations → Confluence opens its dedicated configuration screen and provides OAuth authorization, accessible site and space selection, read-only or write-back access, sync frequency, sync status, reconnection, and disconnection. A deployment operator configures `TITAN_CONFLUENCE_CLIENT_ID`, `TITAN_CONFLUENCE_CLIENT_SECRET`, and `TITAN_CONFLUENCE_REDIRECT_URI` for the shared Titan OAuth app. Register the exact callback address in Atlassian’s developer console. Read scopes are `read:page:confluence`, `read:space:confluence`, and `offline_access`; enabling edits additionally requests `write:page:confluence`. Users never submit API tokens or create personal developer apps. App access remains subject to Atlassian consent and organization policy.

`TITAN_STATE_DIR` must be outside the connected knowledge repository before authorization. Workspace-specific `connected.sqlite` stores private Markdown projections, source markup, stable `(cloud ID, page ID) → Titan UUID` bindings, private history, sync progress, receipts, and encrypted tokens. AES-256-GCM tokens use a deployment-local 0600 key; protect the state directory and key together when backing up. The `ConnectedStorage` overlay routes any transaction referring to connected record IDs or existing private paths into a single SQLite transaction, including dependent records, relationships, events, and inference jobs. Native transactions continue using Git. This keeps connected knowledge and its dependent metadata out of repository publication. Backing up only Git does not back up connected knowledge.

Sync runs in resumable batches of ten pages. It enumerates v2 page metadata, fetches bodies only for new or changed source versions, and skips record writes and inference when the source version is unchanged. Each poll enumerates selected spaces rather than using CQL incremental search; the completed enumeration reconciles missing pages. Pagination follows only the selected tenant’s Atlassian API paths and rejects redirects. The worker persists its cursor and seen IDs, respects `Retry-After`, backs off after failures, and serializes work. Links between connected pages become proposed `relates` connections bound to exact revisions, without establishing support. Manual refresh fetches an individual page. Successful observations renew a 15-minute access lease; expired, disconnected, missing, or revoked connected records and source-dependent summaries are excluded from reads, history, search, context, and audit views. This is a bounded freshness policy, not instantaneous permission revocation. Full organization sharing remains gated on user-specific permission enforcement; the current integration belongs to the single workspace owner and their scoped agents.

Confluence content is normalized from storage-format XML without executing macros or fetching referenced attachments. Common text, headings, lists, quotes, links, code, and tables become Markdown. Unknown macros, embeds, attachments, unsafe links, merged table cells, and unsupported markup are identified, with original markup retained privately. Pages over Titan’s content/title limits are represented with an explicit conversion issue. Such pages cannot be written back or migrated until their unsupported content is resolved; Titan does not silently replace the source with a partial conversion.

Private composer drafts remain local. Connected-page publication goes through the Confluence connector, checks the captured Titan revision and remote version, and sends the next remote version. A conflict retains the draft and observes the newer page for comparison. A durable write receipt allows interrupted saves to inspect the remote version and submitted content before retrying. Reads and metadata editing use the ordinary domain rules; generic content PATCH requests cannot bypass source ownership or modify reserved Confluence provenance.

**Move to Titan** previews the page, source version, connection count, and conversion issues. It rechecks the remote source before moving, writes native Markdown under the same Titan ID, preserves private revision history, and rebinds current relationships for the metadata-only ownership transfer. Durable migration receipts recover an interruption after the Git write. The original Confluence page is unchanged. Later observed source versions are recorded separately and surfaced for comparison; polling cannot overwrite Titan-owned content. Migration intentionally makes that page’s content eligible for Git publication. Private historical artifacts and earlier connection metadata remain local.

Connection endpoints are owner-only under `/api/v1/integrations/confluence`: GET status, POST `/authorize`, GET `/sites`, GET `/spaces?siteId=…`, PUT configuration, POST `/sync`, and DELETE disconnect. The GET `/callback` endpoint is public but requires a single-use, expiring state created by an authenticated owner. It exchanges the authorization code on the server and redirects without putting credentials in the URL. Page source actions live under `/api/v1/units/:id/confluence`: GET `/source`, POST `/refresh`, and GET/POST `/migration`. Composer publication automatically selects write-back for connected pages.

The POC supports one selected Confluence Cloud site with multiple selected spaces, existing-page write-back, and individual page migration. It does not yet copy attachments, execute macros, create new Confluence pages, migrate spaces in bulk, or install webhooks. Distributed desktop OAuth needs a hosted broker or equivalent operator-managed secret handling; the client secret is never bundled in the frontend. Live tenant latency and consent require an operator-configured OAuth app; automated tests use a simulated Atlassian transport.

API references: [OAuth](https://developer.atlassian.com/cloud/confluence/oauth-2-3lo-apps/), [pages](https://developer.atlassian.com/cloud/confluence/rest/v2/api-group-page/), [spaces](https://developer.atlassian.com/cloud/confluence/rest/v2/api-group-space/).
