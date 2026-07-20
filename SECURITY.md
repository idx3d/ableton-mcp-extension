# Security Policy

## Threat model

This extension runs an MCP server over HTTP **bound to 127.0.0.1 only**, inside
Ableton Live's Extension Host (a local Node.js process). Defenses in place:

- Loopback-only bind — never reachable from the network.
- `Host`/`Origin` header validation — rejects DNS-rebinding attempts from browsers.
- Mandatory bearer token on every request, generated per install.
- Filesystem access restricted to the SDK's sandbox (storage/temp directories).

What the server can do if compromised: modify the currently open Live set (bounded by
Live's undo history) — it has no network egress requirements and no access to
arbitrary files.

## Reporting a vulnerability

Please report vulnerabilities privately via
[GitHub Security Advisories](../../security/advisories/new) rather than public issues.
You should receive a response within a week.
