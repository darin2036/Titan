# Titan

An agent-first knowledge and work workspace. Markdown records are portable; interpretations, evidence, and decisions have an inspectable history. Humans think with agents instead of maintaining tickets and relationships by hand.

## Run locally

Requires **Node.js 24+**, **Python 3.11+**, and Git. No Python packages or API keys are needed for the demo.

```sh
npm install
npm run demo
```

Open the local workspace link printed by the launcher. It contains a local owner token, which is exchanged for an HttpOnly session cookie and removed from the URL. Keep that link private. The token is stored with owner-only permissions under `.local/state/owner-token`.

The launcher runs the UI on `127.0.0.1:5173`, the API on `127.0.0.1:4310`, and Python intelligence on `127.0.0.1:4311`. Stop all three with Ctrl+C.

`npm run demo` initializes `.local/demo-workspace` with isolated example records. `npm run dev` starts an empty `.local/workspace`. Set `TITAN_WORKSPACE` to choose a local repository, or connect a path or HTTPS GitHub URL in Settings. GitHub uses your existing Git credential helper; do not put credentials in the repository URL.

```sh
TITAN_WORKSPACE=/path/to/knowledge npm run dev
npm run check
```

## Try the demonstration

1. Browse the example knowledge, decisions, work, and evidence.
2. Open **Review inbox**. Accept the proposed production authentication supersession.
3. Search for authentication. The new decision comes first; the original remains historical and warns that it cannot serve as the current basis.
4. Choose **New record** and describe knowledge or work. Inspect the generated Markdown before applying it.
5. Open the floating ✳ agent bubble and drag its header to keep it beside your content. Click the bubble again or press Escape to minimize; your message stays intact. With the bubble focused, arrow keys reposition it. Select a passage in a document to attach it to the chat, then ask for a revision. Fixture mode replaces the exact selected passage with your instruction; live providers synthesize the requested edit.
6. Open **Learning** to capture a deployment-local dataset manifest, evaluate a baseline candidate, activate it, and roll back.
7. Ask to **Remove this record**, review the preview, and apply it. Agents can no longer retrieve it. The human owner can inspect and restore it in **Trash**.

Fixture inference recognizes explicit `Implements: UUID`, `Supports: UUID`, `Supersedes: UUID`, `Contradicts: UUID`, `Blocks: UUID`, and `Contains: UUID` references. These deterministic fixtures test the pipeline, not general semantic understanding. Live adapters infer relationships from supplied records.

## Bring your own intelligence

Supply keys to the launcher through your shell environment or a secrets manager. They are inherited only by server processes; Titan does not store keys in repositories, browser storage, prompts, or audit events.

```sh
export OPENAI_API_KEY=...
export ANTHROPIC_API_KEY=...
npm run dev
```

In **Settings**, choose OpenAI or Anthropic and explicitly enter an available model ID. OpenAI uses the Responses API with storage disabled; Anthropic uses the Messages API. Model access and billing belong to your provider account. No provider key is required merely to browse records.

Optional OpenAI embeddings require an explicit embedding model and OpenAI credentials, even when conversation uses Anthropic. Vectors are derived, revision-bound, and stored locally. Without embeddings, full-text search and graph traversal remain available. Inference jobs populate vectors for changed records; reauthor a record or queue inference after enabling embeddings to populate existing content.

Titan controls context, instructions, validation, evidence requirements, inference policy, and evaluations. BYO versus future product-managed credentials does not change that pipeline.

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
  "extensions": {},
}
---

## Claim

Production services use short-lived workload identity.
```

Namespaced extensions allow future features. Derived summaries should include `extensions["titan:sources"]`, a map from source UUIDs to exact revisions. Such summaries are excluded from agent reads and search if a source is missing, removed, or revised. They must be regenerated with fresh provenance.

`.titan/` holds workspace policy, configurable relationship types, assertions, reviews, events, jobs, feedback, dataset manifests, and model descriptors. These records travel with the repository. SQLite projections and large model artifacts stay in local state outside the knowledge repository.

Transactions stage only their own change set and refuse to operate over pre-existing staged changes. A recovery journal inside Git metadata rolls back an interrupted uncommitted change set. Publication explicitly pushes to `titan/workspace`, refuses divergent histories, and never force-pushes.

## Agent integration

Create a scoped integration token in Settings. Tokens are stored hashed in local state and are not copied into the knowledge repository. Both HTTP and MCP use the same domain rules.

```sh
export TITAN_AGENT_TOKEN=...
npm run mcp
```

Configure your MCP client to launch `npm run mcp` in this checkout with `TITAN_AGENT_TOKEN`. The client must have the local API running. Optional `TITAN_API_URL` changes its API destination.

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

## License

Titan is **source-available** under [PolyForm Shield 1.0.0](LICENSE), with an [additional permission for noncommercial community forks](ADDITIONAL-PERMISSIONS.md). You can use Titan internally in your business, inspect and modify the code, and contribute improvements. Providing a competing commercial product or hosted service requires a separate license from Darin LaFramboise.

The additional permission allows noncommercial community forks, including sharing modified source. It does not authorize competing commercial offerings. These restrictions mean Titan is not OSI-approved open-source software. Dependency licenses remain their own.

The maintainer may offer separately licensed commercial or hosted versions. Community contributors retain ownership and provide the commercial licensing rights described in the [contributor agreement](CONTRIBUTOR-AGREEMENT.md).

## Contributing

Start with [CONTRIBUTING.md](CONTRIBUTING.md). Bug reports, feature discussions, and focused pull requests are welcome. Code and documentation contributions require explicit acceptance of the contributor agreement before merging. Report vulnerabilities using [the private security reporting process](SECURITY.md).
