# Titan

**Shared knowledge and work, built around agents.**

[![Checks](https://github.com/darin2036/Titan/actions/workflows/check.yml/badge.svg)](https://github.com/darin2036/Titan/actions/workflows/check.yml)
[![License: source-available](https://img.shields.io/badge/license-source--available-28785d)](#license)

Titan brings the core of a knowledge base and a work tracker into one local workspace. Agents author records, connect ideas to work and evidence, and propose changes. People think with the agent, review consequential decisions, and inspect the history behind the system's understanding.

The underlying records are Markdown in Git. The human interface is a readable workspace over that shared memory, while external agents use the same records through MCP or a versioned API.

**Status:** early proof of concept, built for a single owner running locally. You can explore the complete demo without API keys or paid model calls. This is not yet a hosted service or a production multi-user application.

![Titan's document workspace with a movable agent panel and highlighted text attached to chat](docs/images/titan-workspace.png)

[Quick start](#quick-start) · [How it works](#how-it-works) · [Agent integration](#connect-your-agents) · [Technical reference](docs/technical-reference.md) · [Contributing](CONTRIBUTING.md) · [License](#license)

## Why Titan

An agent needs more than a folder of documents. It needs to know what a record applies to, what evidence supports it, whether a newer decision replaced it, and whether it is safe to use as the basis for work.

Titan explores a different way to maintain that context:

- **Knowledge and work belong together.** Decisions, implementation work, and observed outcomes can support or challenge the same claim.
- **Age is not validity.** Old knowledge may remain useful; recent knowledge may already be disputed or superseded.
- **Agents maintain the connections.** People direct changes through conversation and review instead of manually organizing every relationship.
- **Interpretations have a history.** Relationships, inference proposals, evidence, and human corrections remain inspectable.
- **Your records stay portable.** Stable IDs and versioned Markdown records separate the knowledge from the interface and its rebuildable indexes.

## Quick start

Install **Node.js 24+**, **Python 3.11+**, and **Git**, then:

```sh
git clone https://github.com/darin2036/Titan.git
cd Titan
npm ci
npm run demo
```

No Python packages or provider credentials are required for the demo.

Open the **Titan workspace link printed by the launcher**. That link signs you into the local workspace; keep it private. Its owner token is exchanged for an HttpOnly session cookie and removed from the URL.

| Service              | Local address           |
| -------------------- | ----------------------- |
| Human workspace      | `http://127.0.0.1:5173` |
| Application API      | `http://127.0.0.1:4310` |
| Intelligence service | `http://127.0.0.1:4311` |

Stop the launcher with **Ctrl+C** to stop all three services. If a port is occupied, stop the other process and restart Titan. You can select a Python executable with the `PYTHON` environment variable.

### Try the demo

The example records describe a move from long-lived production API keys to workload identity.

1. Browse **Knowledge**, **Work**, **Decisions**, and **Evidence** to see the connected records.
2. Open **Review inbox** and accept the proposed supersession of the original authentication decision.
3. Search for authentication. Inspect the replacement and the historical record's warning: the old decision remains available but is marked unsuitable as a current basis.
4. Select **New record**, describe an idea, and review the agent's draft before applying it.
5. Open the floating **✳** bubble. Drag its header or icon to move it beside your document. Highlight a passage to attach it to the conversation; the chat shows a small context preview you can clear. Click the bubble again or press **Escape** to minimize it without losing your message. With the icon focused, arrow keys move it.
6. Open **Learning** to capture a local dataset manifest, evaluate a baseline candidate, activate it, and roll back.
7. Ask the agent to remove a record, review the preview, and apply it. The record is excluded from agent context; the human owner can restore it from **Trash**.

**Demo inference is deterministic.** It exercises the workflow rather than understanding arbitrary requests. For a selected passage, it replaces that passage with your instruction. Relationship fixtures recognize references such as `Supports: UUID` and `Supersedes: UUID`. Configure a live provider for model-generated drafting and relationship proposals.

## Use your own knowledge repository

Start an empty workspace with:

```sh
npm run dev
```

Or initialize and use a local Git repository:

```sh
TITAN_WORKSPACE=/absolute/path/to/knowledge npm run dev
```

You can also connect a local path or an HTTPS GitHub repository URL in **Settings**. GitHub access uses your existing Git credential helper. Initialization is idempotent and preserves unrelated files.

| Location                               | Contents                                                                     |
| -------------------------------------- | ---------------------------------------------------------------------------- |
| `.local/demo-workspace/`               | Default demo repository                                                      |
| `.local/workspace/`                    | Default empty repository                                                     |
| `.local/state/`                        | Local authentication, indexes, queues, and derived artifacts                 |
| `records/` in the knowledge repository | Markdown knowledge, work, decision, and evidence records                     |
| `.titan/` in the knowledge repository  | Durable policies, relationships, reviews, provenance, and learning manifests |

Keep the knowledge repository separate from this application checkout. Records and their durable history belong to your knowledge repository; local state and secrets do not. Set `TITAN_STATE_DIR` to change the state directory. GitHub publication is explicit and uses the dedicated `titan/workspace` branch; Titan does not force-push over divergent history.

## How it works

**Describe → draft → review → apply → connect → retrieve.**

A conversation becomes a proposed record change. The domain engine validates the change, checks the source revision, records provenance, and applies the authorized operation. Intelligence jobs return structured relationship proposals; policy determines which can be accepted automatically and which need review.

| Capability              | Available today                                                                                       |
| ----------------------- | ----------------------------------------------------------------------------------------------------- |
| Shared records          | Knowledge, work, decisions, and evidence in versioned Markdown with stable IDs                        |
| Conversational editing  | Draft previews, selected-passage context, and a movable agent panel                                   |
| Connected knowledge     | Typed relationships, evidence references, contradiction and supersession handling                     |
| Retrieval               | Full-text search and graph context with revisions, scope, validity, and warnings; optional embeddings |
| Oversight               | Review inbox, revision history, decision log, and bounded stored justifications                       |
| Agent access            | Scoped integration tokens, HTTP API, and a local MCP server                                           |
| External execution      | Signed `work.ready` webhooks and authenticated outcome submission                                     |
| Learning infrastructure | Local feedback, dataset lineage, deterministic candidate evaluation, activation, and rollback         |
| Retention               | Audited soft removal, agent exclusion, and human-only restoration                                     |

The default **bounded** autonomy mode lets agents maintain routine relationships and evidenced progress, while consequential decisions require review. **Full** mode permits more automatic actions under the same validation and evidence rules. Neither lets agents restore removed records, change authorization, activate models, or purge data.

Implementation being finished is separate from accepted completion. An agent saying “done” or reporting a passing test does not by itself establish verified evidence or accepted work.

## Bring your own model

Titan supports OpenAI and Anthropic through the same controlled intelligence pipeline. Export the key for the provider you want to use before starting the launcher:

```sh
# Choose the provider you need; do not commit real keys.
export OPENAI_API_KEY='<your-key>'
# Or: export ANTHROPIC_API_KEY='<your-key>'
npm run dev
```

In **Settings**, select your provider and explicitly enter an available model ID. Provider usage is billed to your account. Credentials stay in server processes and are not recorded in the knowledge repository, browser storage, model context, or audit logs. Titan does not automatically load a repository `.env` file.

Live inference sends the assembled record context to the selected provider. The fixture demo makes no model calls. Optional OpenAI embeddings need separate embedding-model configuration and OpenAI credentials; search remains functional without them.

## Connect your agents

Create an integration token with the scopes your agent needs in **Settings**. With Titan running, configure an MCP client to launch this command from the application checkout:

```sh
export TITAN_AGENT_TOKEN='<scoped-integration-token>'
npm --silent run mcp
```

The MCP server uses standard input/output. Keep its token in your client's local environment or secrets configuration, outside version control. Both MCP and HTTP operations pass through the same domain policy and revision checks.

Tools include `search_context`, `read_unit`, `create_unit`, `revise_unit`, `establish_relationship`, `remove_unit`, `record_outcome`, and `record_feedback`. HTTP integrations use `/api/v1` with bearer authentication. See the [integration contracts](docs/technical-reference.md#agent-integration) for endpoints and token configuration.

Coding execution stays in your existing tools. Titan can send a signed `work.ready` webhook to a user-configured workflow, then receive evidence and outcomes through the API. It does not launch or orchestrate coding agents. [Webhook details](docs/technical-reference.md#external-coding-workflows)

## Direction and current limits

The longer-term goal is deployment-specific learning about relationships and task relevance, grounded in that deployment's feedback and outcomes. Titan does **not** currently train a neural network, fine-tune models, or claim to have a learned relevance model. The current baseline and evaluation infrastructure make those future experiments possible without replacing the record contracts.

Areas for future work include richer evaluations, learned retrieval ranking and relationship classification, stronger conflict-review workflows, and shared storage and multi-user access. Hosted SaaS, billing, S3 storage, cross-deployment learning, and irreversible purge are deferred.

Titan currently binds to loopback and assumes one trusted human owner. Public internet deployment is outside the current scope. Removal controls what Titan supplies to agents; they cannot retract copies already sent elsewhere or prevent someone with direct Git access from reading history.

## Development and contributing

```sh
npm run check       # Type checking, production build, and automated tests
npm run format      # Format the application, scripts, tests, and main README
```

The automated suite requires no paid model calls. It covers policy, revisions, retention, storage, authentication, webhooks, and an actual Python/HTTP/MCP integration. Provider adapters use mocked responses; live provider availability requires your own account.

We welcome reproducible bug reports, focused pull requests, and discussion of how teams and agents should work with knowledge. Start with [CONTRIBUTING.md](CONTRIBUTING.md), use [Issues](https://github.com/darin2036/Titan/issues) for bugs and proposals, or join [Discussions](https://github.com/darin2036/Titan/discussions). See the [technical reference](docs/technical-reference.md) for architecture and storage, and the [design guide](docs/titan-brand-and-design-guide.md) for UI work.

Code and documentation contributors retain ownership and explicitly accept the [contributor agreement](CONTRIBUTOR-AGREEMENT.md) before merging. It grants the maintainer rights to include accepted contributions in future commercially licensed or hosted versions. Acceptance is currently verified manually.

Please report vulnerabilities privately through GitHub's **Security → Report a vulnerability** flow. [Security policy](SECURITY.md)

## License

Titan is **source-available** under [PolyForm Shield 1.0.0](LICENSE), with an [additional permission for noncommercial community forks](ADDITIONAL-PERMISSIONS.md).

- Internal business use, inspection, modification, and community contributions are permitted subject to the license terms.
- Noncommercial community forks and sharing modified source are explicitly permitted.
- Providing a competing commercial product or hosted service requires a separate license from Darin LaFramboise.
- The maintainer may offer separately licensed commercial and hosted versions.

These restrictions mean Titan is not MIT-licensed or OSI-approved open-source software. Dependencies retain their own licenses. The linked license and additional permission contain the controlling terms.
