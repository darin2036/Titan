# Contributing to Titan

Titan is an early, local-first knowledge and work system built around agents. We welcome reproducible bug reports, focused improvements, and discussion of how agents and people work with knowledge.

## Before you start

Read [README.md](README.md) for the architecture and current limitations, and [LICENSE](LICENSE) for the terms that apply to the code. Open an issue before a large change so we can agree on scope. Never include provider keys, owner tokens, private workspace records, or real customer data in issues, screenshots, or test fixtures.

For UI changes, follow [the brand and design guide](docs/titan-brand-and-design-guide.md). Keep the interface calm, accessible, and useful on smaller screens.

## Contributor agreement

Code and documentation contributions require acceptance of [Titan Contributor Agreement v1.0](CONTRIBUTOR-AGREEMENT.md). You keep ownership of your work. The agreement gives Darin LaFramboise rights to distribute and sublicense your accepted contributions, including in commercial and hosted versions.

Each person contributing code or documentation to a pull request must post this comment from their own GitHub account before the contribution is merged:

> I agree to the Titan Contributor Agreement v1.0 in CONTRIBUTOR-AGREEMENT.md for my contributions in this pull request. I have authority to grant these rights, including any required employer permission.

A checkbox or another person's acceptance does not replace your own comment. If you cannot grant these rights, discuss the situation with the maintainer before submitting code. Ordinary bug reports and feature suggestions do not require signing; do not paste code you cannot license into an issue.

**Maintainer merge check:** verify and retain an acceptance comment from every contributing author, confirm that it covers the final contribution, and check third-party notices before merging. Agreement acceptance is currently checked manually; automated tests do not verify it. Changes to this agreement require new acceptance of the revised terms.

## Development

You need Node.js 24+, Python 3.11+, and Git.

```sh
npm ci
npm run demo
npm run check
```

The demo uses isolated example records. Automated checks use deterministic fixtures and mocked providers; contributions must not require paid model calls or cloud credentials to pass.

## Pull requests

Keep each pull request focused. Describe the problem, the resulting behavior, and how you verified it. Include a screenshot for visible UI changes. Add meaningful behavior tests when changing authorization, retention, revision handling, inference validation, storage, or external integrations.

All durable mutations belong in the TypeScript domain engine. UI, API, MCP, and intelligence adapters must use those operations. Preserve stable record IDs, revision checks, audit provenance, and removal exclusions. Do not give intelligence workers unrestricted repository access.

Tell us when an agent helped author your change, and review its output before submitting. You remain responsible for the contribution and for having permission to submit any third-party code.

## Security reports

Do not disclose exploitable vulnerabilities or private data in public issues. See [SECURITY.md](SECURITY.md) for the private reporting process.
