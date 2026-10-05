# Security

Titan is currently an experimental, single-owner application. Its services bind to loopback. It has not been reviewed for public internet deployment or multi-user hosting.

## Reporting a vulnerability

Use the repository's **Security → Report a vulnerability** option when private reporting is available. If that option is unavailable, open an issue asking the maintainer to arrange a private reporting channel without including the vulnerability details, exploits, credentials, or private records.

Include affected versions, a minimal reproduction with synthetic data, and the expected security boundary. Do not test against anyone else's deployment without authorization.

## Sensitive local data

Keep provider credentials, owner and integration tokens, webhook secrets, organizational records, and local learning artifacts out of this source repository. The ignored `.local/` directory holds local runtime state and demo workspaces. Sanitizing a screenshot includes checking URLs and selected document content as well as visible form fields.
