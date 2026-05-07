# MCP Auth — Server Conformance

Tests an MCP server's OAuth 2.0 discovery surface required by the MCP authorization spec (2025-11-25).

Four ClientScenarios so far, in priority order:

- **Phase 1 — `auth-oauth-discovery`**: read-only RFC 9728 PRM + RFC 8414 AS metadata. No token flows. (5 checks)
- **Phase 2 — `auth-jwt-validation`**: RFC 6750 Bearer-token enforcement on auth-gated methods. No-token / malformed / tampered / valid-token paths. (5 checks; 2 emit INFO without `AUTH_VALID_TOKEN`)
- **Phase 2.5 — `auth-jwt-claims`**: RFC 7519 standard claim validation. Expired (`exp`), wrong-audience (`aud`), wrong-issuer (`iss`) — each must be rejected even though the JWT signature verifies. (3 checks; each emits INFO without its corresponding `AUTH_{EXPIRED,WRONG_AUDIENCE,WRONG_ISSUER}_TOKEN`)
- **Phase 3a — `auth-scope-step-up`**: SEP-2350 + RFC 6750 §3.1 scope enforcement. 403 + `error="insufficient_scope"` + `scope="..."` advertisement. (5 checks; require `AUTH_VALID_TOKEN` and/or `AUTH_READWRITE_TOKEN` to fully exercise)

All four tagged `['extension', LATEST_SPEC_VERSION]` and registered in `pendingClientScenariosList` so default `all-scenarios.test.ts` runs against the upstream `everything-server` skip this suite.

## ClientScenario classes

### `auth-oauth-discovery` (`auth.ts`)

Single class with 5 internal `ConformanceCheck` records covering the OAuth 2.0 discovery surface.

| Check                                           | What it tests                                                                                                                                                                         |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth-oauth-discovery-prm-root`                 | GET `/.well-known/oauth-protected-resource` returns 200 + RFC 9728 JSON with `resource` and non-empty `authorization_servers`                                                         |
| `auth-oauth-discovery-prm-path-based`           | When the MCP endpoint has a non-root path, the path-based variant `/.well-known/oauth-protected-resource{mcpPath}` is also reachable (RFC 9728 §3.1). Emits INFO when root            |
| `auth-oauth-discovery-prm-content-type`         | PRM endpoint returns `Content-Type: application/json`                                                                                                                                 |
| `auth-oauth-discovery-as-metadata`              | AS metadata reachable on the resource origin OR on an advertised `authorization_servers` entry, returns 200 + RFC 8414 JSON with `issuer`, `authorization_endpoint`, `token_endpoint` |
| `auth-oauth-discovery-as-metadata-content-type` | AS metadata returns `Content-Type: application/json` (or INFO when same-origin proxy is absent and AS lives off-origin)                                                               |

### `auth-jwt-validation` (`auth.ts`)

5 internal `ConformanceCheck` records covering Bearer-token enforcement on the fixture's `echo` tool (auth-gated, no specific scope required — keeps JWT validation testing separate from scope-enforcement testing planned for Phase 3).

| Check                                          | What it tests                                                                                                                                              |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth-jwt-validation-no-token-rejected`        | `tools/call` without `Authorization` header → HTTP 401 (RFC 6750 + MCP authorization spec)                                                                 |
| `auth-jwt-validation-www-authenticate-shape`   | 401 response carries `WWW-Authenticate: Bearer ...` (RFC 6750 §3); WARNING when `resource_metadata` parameter is missing (RFC 9728 §5.1 SHOULD)            |
| `auth-jwt-validation-malformed-token-rejected` | `tools/call` with garbage Bearer token (not a structurally valid JWT) → HTTP 401                                                                           |
| `auth-jwt-validation-tampered-token-rejected`  | `tools/call` with valid JWT whose signature has been tampered → HTTP 401 (signature verification mandatory). INFO when `AUTH_VALID_TOKEN` env var is unset |
| `auth-jwt-validation-valid-token-accepted`     | `tools/call` with valid token → HTTP not 401 (allowed past auth gate). INFO when `AUTH_VALID_TOKEN` env var is unset                                       |

The tampered-token check derives a forged JWT from `AUTH_VALID_TOKEN` by flipping the last byte of the signature segment — keeps the JWT structurally valid (3 parts, parseable header + payload) but breaks signature verification. The fixture is responsible for rejecting it.

### `auth-jwt-claims` (`auth.ts`)

3 internal `ConformanceCheck` records covering RFC 7519 standard claim validation. Each test sends a properly-signed JWT (so the JWKS signature check passes) whose claims violate one specific RFC 7519 requirement.

| Check                                     | What it tests                                                                                                                                           |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth-jwt-claims-expired-rejected`        | Properly signed token with `exp` in the past → HTTP 401 (RFC 7519 §4.1.4). INFO when `AUTH_EXPIRED_TOKEN` env unset                                     |
| `auth-jwt-claims-wrong-audience-rejected` | Properly signed token with `aud` ≠ resource URI → HTTP 401 (RFC 7519 §4.1.3). INFO when `AUTH_WRONG_AUDIENCE_TOKEN` env unset                           |
| `auth-jwt-claims-wrong-issuer-rejected`   | Token signed by trusted AS but with `iss` claim claiming a different issuer → HTTP 401 (RFC 7519 §4.1.1). INFO when `AUTH_WRONG_ISSUER_TOKEN` env unset |

Each token shape is a deliberate single-claim violation — the signature is valid (signed by the trusted AS), so each test isolates one claim-validation behavior. The fixture is responsible for minting these tokens (e.g., a `MintExpiredToken` / `MintWrongAudienceToken` / `MintWrongIssuerToken` helper that overrides RFC 7519 defaults via `MintTokenWithClaims`-style API).

### `auth-scope-step-up` (`auth.ts`)

5 internal `ConformanceCheck` records covering scope enforcement on the fixture's `write-tool` (requires `write` scope) and `admin-tool` (requires `admin` scope). The scenario initializes a session with each token before issuing the scope-checked `tools/call`, since scope middleware runs after session resolution.

| Check                                                | What it tests                                                                                                                                                                                  |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth-scope-step-up-insufficient-scope-rejected`     | `tools/call` to `write-tool` with read-only token → HTTP 403 (RFC 6750 §3.1). INFO when `AUTH_VALID_TOKEN` env unset                                                                           |
| `auth-scope-step-up-www-authenticate-error`          | 403 carries `WWW-Authenticate: Bearer error="insufficient_scope"` (RFC 6750 §3.1)                                                                                                              |
| `auth-scope-step-up-www-authenticate-advertises-scope` | 403 carries `scope="..."` parameter listing missing scope (SEP-2350; clients use this to drive scope step-up)                                                                                |
| `auth-scope-step-up-sufficient-scope-accepted`       | `tools/call` to `write-tool` with `read+write` token → HTTP not 403 (allowed past scope gate). INFO when `AUTH_READWRITE_TOKEN` env unset                                                      |
| `auth-scope-step-up-scope-varies-by-tool`            | `admin-tool` advertises `admin` and `write-tool` advertises `write` — server MUST compute the missing scope per-operation, not advertise a static placeholder. INFO when `AUTH_VALID_TOKEN` env unset |

## Required server fixture

The fixture server MUST expose:

| Endpoint                                                                                | Required by                        | Shape                                                     |
| --------------------------------------------------------------------------------------- | ---------------------------------- | --------------------------------------------------------- |
| `/.well-known/oauth-protected-resource`                                                 | RFC 9728 + MCP 2025-11-25          | `{ resource, authorization_servers, ... }`                |
| `/.well-known/oauth-protected-resource{mcpPath}`                                        | RFC 9728 §3.1 (when mcpPath ≠ `/`) | same shape                                                |
| `/.well-known/oauth-authorization-server` (or off-origin equivalent advertised via PRM) | RFC 8414                           | `{ issuer, authorization_endpoint, token_endpoint, ... }` |
| An auth-gated tool named `echo` accepting `{message: string}`                           | Phase 2 + 2.5                      | requires Bearer auth but no specific scope                                          |
| Two scope-gated tools named `write-tool` (requires `write`) and `admin-tool` (requires `admin`) | Phase 3a                           | scope enforcement returns 403 + WWW-Authenticate `scope="..."` per missing scope    |
| Mint helpers exposing valid + deliberately-bad-claim + multi-scope tokens               | Phase 2 + 2.5 + 3a                 | tokens passed via env vars (see token-acquisition below)                            |

Any-language fixture works. One example reference implementation lives at https://github.com/panyam/mcpkit/tree/main/examples/auth, which mounts the well-known endpoints via `auth.MountAuth(...)` and pre-mints the four token shapes (`tok_read` valid, plus `tok_expired`, `tok_wrong_audience`, `tok_wrong_issuer`) via `MintTokenWithClaims`-based helpers and serves them at `/demo/bootstrap`.

## Running

```bash
# Auto-spawn fixture (recommended)
AUTH_SERVER_URL=http://localhost:18098/mcp \
AUTH_SERVER_CMD="/path/to/auth-server --serve --addr=:18098" \
  npx vitest run src/scenarios/server/auth/auth.test.ts

# Already-running server
AUTH_SERVER_URL=http://localhost:8080/mcp \
  npx vitest run src/scenarios/server/auth/auth.test.ts

# With all Phase 2 + 2.5 + 3a token-needing checks enabled
AUTH_SERVER_URL=http://localhost:18098/mcp \
AUTH_VALID_TOKEN="eyJhbGciOi..." \
AUTH_READWRITE_TOKEN="eyJhbGciOi..." \
AUTH_FULL_TOKEN="eyJhbGciOi..." \
AUTH_EXPIRED_TOKEN="eyJhbGciOi..." \
AUTH_WRONG_AUDIENCE_TOKEN="eyJhbGciOi..." \
AUTH_WRONG_ISSUER_TOKEN="eyJhbGciOi..." \
  npx vitest run src/scenarios/server/auth/auth.test.ts
```

If `AUTH_SERVER_URL` is unset, the suite is skipped. Token-needing checks emit `INFO` rather than `FAILURE` when their token env var is unset — they're "couldn't verify" rather than "spec violation."

Token acquisition is fixture-specific: the test runner is responsible for obtaining each token shape from the fixture (e.g., via a bootstrap endpoint that exposes pre-minted bad tokens, a token-endpoint flow, or pre-minted via env) and exporting them via the `AUTH_*_TOKEN` env vars before invoking the scenario.

## Roadmap

| Phase | Scenario                                                                           | Status                                |
| ----- | ---------------------------------------------------------------------------------- | ------------------------------------- |
| 1     | `auth-oauth-discovery` (PRM + AS metadata)                                         | shipped                               |
| 2     | `auth-jwt-validation` (no-token / malformed / tampered / valid-token)              | shipped                               |
| 2.5   | `auth-jwt-claims` (audience, expiry, issuer)                                       | shipped                               |
| 3a    | `auth-scope-step-up` (SEP-2350: 403 + scope advertisement)                         | shipped                               |
| 3b    | `auth-iss-param` (RFC 9207, SEP-2468)                                              | planned, needs OAuth code flow driver |
| 3c    | `auth-enterprise-managed` (RFC 8693 token exchange + RFC 7523 JWT bearer chain)    | planned, needs OAuth token-flow driver |

Phase 2 + 2.5 + 3a need the fixture to mint pre-issued tokens at multiple scope levels plus deliberately-bad-claim variants; the test runner exposes each as a separate `AUTH_*_TOKEN` env var. Phase 3a additionally needs at least two scope-gated tools (`write-tool` + `admin-tool`) to verify scope advertisement varies per-operation.

Phases 3b (`auth-iss-param`) and 3c (`auth-enterprise-managed`) lift the bar substantially — they need the conformance scenarios to drive actual OAuth flows (auth code redirect for RFC 9207 iss validation; full token-exchange flow for RFC 8693 + RFC 7523 chain). That fixture-/runner-design decision lands when those phases start.
