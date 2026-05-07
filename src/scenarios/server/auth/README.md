# MCP Auth — Server Conformance

Tests an MCP server's OAuth 2.0 discovery surface required by the MCP authorization spec (2025-11-25).

Phase 1 of the auth conformance pillar covers **read-only discovery only** — no token flows. Token validation, scope step-up, and `iss` parameter validation will land as separate scenarios that build on this foundation.

Tagged `['extension', LATEST_SPEC_VERSION]`. Registered in `pendingClientScenariosList` so default `all-scenarios.test.ts` runs against the upstream `everything-server` skip this suite.

## ClientScenario class

### `auth-oauth-discovery` (`auth.ts`)

Single class with 5 internal `ConformanceCheck` records covering the OAuth 2.0 discovery surface.

| Check                                           | What it tests                                                                                                                                                                         |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth-oauth-discovery-prm-root`                 | GET `/.well-known/oauth-protected-resource` returns 200 + RFC 9728 JSON with `resource` and non-empty `authorization_servers`                                                         |
| `auth-oauth-discovery-prm-path-based`           | When the MCP endpoint has a non-root path, the path-based variant `/.well-known/oauth-protected-resource{mcpPath}` is also reachable (RFC 9728 §3.1). Emits INFO when root            |
| `auth-oauth-discovery-prm-content-type`         | PRM endpoint returns `Content-Type: application/json`                                                                                                                                 |
| `auth-oauth-discovery-as-metadata`              | AS metadata reachable on the resource origin OR on an advertised `authorization_servers` entry, returns 200 + RFC 8414 JSON with `issuer`, `authorization_endpoint`, `token_endpoint` |
| `auth-oauth-discovery-as-metadata-content-type` | AS metadata returns `Content-Type: application/json` (or INFO when same-origin proxy is absent and AS lives off-origin)                                                               |

## Required server fixture

The fixture server MUST expose:

| Endpoint                                                                                | Required by                        | Shape                                                     |
| --------------------------------------------------------------------------------------- | ---------------------------------- | --------------------------------------------------------- |
| `/.well-known/oauth-protected-resource`                                                 | RFC 9728 + MCP 2025-11-25          | `{ resource, authorization_servers, ... }`                |
| `/.well-known/oauth-protected-resource{mcpPath}`                                        | RFC 9728 §3.1 (when mcpPath ≠ `/`) | same shape                                                |
| `/.well-known/oauth-authorization-server` (or off-origin equivalent advertised via PRM) | RFC 8414                           | `{ issuer, authorization_endpoint, token_endpoint, ... }` |

Any-language fixture works. One example reference implementation lives at https://github.com/panyam/mcpkit/tree/main/examples/auth, which mounts these endpoints via `auth.MountAuth(...)`.

## Running

```bash
# Auto-spawn fixture (recommended)
AUTH_SERVER_URL=http://localhost:18098/mcp \
AUTH_SERVER_CMD="/path/to/auth-server --serve --addr=:18098" \
  npx vitest run src/scenarios/server/auth/auth.test.ts

# Already-running server
AUTH_SERVER_URL=http://localhost:8080/mcp \
  npx vitest run src/scenarios/server/auth/auth.test.ts
```

If `AUTH_SERVER_URL` is unset, the suite is skipped.

## Roadmap

| Phase | Scenario                                                                           | Status                                |
| ----- | ---------------------------------------------------------------------------------- | ------------------------------------- |
| 1     | `auth-oauth-discovery` (PRM + AS metadata)                                         | this file                             |
| 2     | `auth-jwt-validation` (claim allowlist, audience, expiry, signature)               | planned                               |
| 3     | `auth-scope-step-up` (SEP-2350: 401/403 retry + scope union from WWW-Authenticate) | planned, after upstream stabilizes    |
| 3     | `auth-iss-param` (RFC 9207, SEP-2468)                                              | planned, paired with mcpkit issue 380 |
| 3     | `auth-enterprise-managed` (RFC 8693 + RFC 7523 chain)                              | planned, paired with mcpkit issue 381 |

Each later phase needs more from the fixture (a real AS issuing tokens of specific shapes); this scenario sets the floor with read-only discovery so the fixture-design decision can be deferred.
