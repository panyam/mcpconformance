# MCP Auth — Server Conformance

Tests an MCP server's OAuth 2.0 discovery surface required by the MCP authorization spec (2025-11-25).

Three ClientScenarios so far, in priority order:

- **Phase 1 — `auth-oauth-discovery`**: read-only RFC 9728 PRM + RFC 8414 AS metadata. No token flows. (5 checks)
- **Phase 2 — `auth-jwt-validation`**: RFC 6750 Bearer-token enforcement on auth-gated methods. No-token / malformed / tampered / valid-token paths. (5 checks; 2 emit INFO without `AUTH_VALID_TOKEN`)
- **Phase 2.5 — `auth-jwt-claims`**: RFC 7519 standard claim validation. Expired (`exp`), wrong-audience (`aud`), wrong-issuer (`iss`) — each must be rejected even though the JWT signature verifies. (3 checks; each emits INFO without its corresponding `AUTH_{EXPIRED,WRONG_AUDIENCE,WRONG_ISSUER}_TOKEN`)

All three tagged `['extension', LATEST_SPEC_VERSION]` and registered in `pendingClientScenariosList` so default `all-scenarios.test.ts` runs against the upstream `everything-server` skip this suite.

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

## Required server fixture

The fixture server MUST expose:

| Endpoint                                                                                | Required by                        | Shape                                                     |
| --------------------------------------------------------------------------------------- | ---------------------------------- | --------------------------------------------------------- |
| `/.well-known/oauth-protected-resource`                                                 | RFC 9728 + MCP 2025-11-25          | `{ resource, authorization_servers, ... }`                |
| `/.well-known/oauth-protected-resource{mcpPath}`                                        | RFC 9728 §3.1 (when mcpPath ≠ `/`) | same shape                                                |
| `/.well-known/oauth-authorization-server` (or off-origin equivalent advertised via PRM) | RFC 8414                           | `{ issuer, authorization_endpoint, token_endpoint, ... }` |
| An auth-gated tool named `echo` accepting `{message: string}`                           | Phase 2 + 2.5                      | requires Bearer auth but no specific scope                |
| Mint helpers exposing valid + deliberately-bad-claim tokens to the test runner          | Phase 2 + 2.5                      | tokens passed via env vars (see token-acquisition below)  |

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

# With all Phase 2 + 2.5 token-needing checks enabled
AUTH_SERVER_URL=http://localhost:18098/mcp \
AUTH_VALID_TOKEN="eyJhbGciOi..." \
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
| 3     | `auth-scope-step-up` (SEP-2350: 401/403 retry + scope union from WWW-Authenticate) | planned, after upstream stabilizes    |
| 3     | `auth-iss-param` (RFC 9207, SEP-2468)                                              | planned, paired with mcpkit issue 380 |
| 3     | `auth-enterprise-managed` (RFC 8693 + RFC 7523 chain)                              | planned, paired with mcpkit issue 381 |

Phase 2 + 2.5 need the fixture to mint a valid token plus three deliberately-bad-claim variants (expired, wrong audience, wrong issuer); the test runner exposes each as a separate `AUTH_*_TOKEN` env var. Phase 3 (scope step-up + RFC 9207 `iss` parameter + RFC 8693 enterprise chain) lifts the bar substantially — needs the fixture to also expose a token endpoint that the conformance suite drives through actual OAuth flows. That decision lands when Phase 3 starts.
