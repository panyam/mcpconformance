# Keycloak fixture for auth conformance scenarios

A self-contained Keycloak instance configured to issue scoped OAuth tokens for MCP authorization-server conformance tests. Currently driven by `scope-challenge` (SEP-2350 step-up); reusable by future server-side auth scenarios.

## What it gives you

- Realm `mcpkit-test` running on `http://localhost:8180`
- Confidential client `mcp-confidential` supporting `client_credentials` and `password` grants
- Three custom scopes: `tools-read`, `tools-call`, `admin-write`
- Two test users (`mcp-testuser` / `testpassword`, `mcp-testuser2` / `testpassword2`)
- Make targets for minting under-scoped and properly-scoped tokens for scenarios

The realm is synced from [`panyam/mcpkit` `tests/keycloak/realm.json`](https://github.com/panyam/mcpkit/blob/main/tests/keycloak/realm.json) (canonical source). When the canonical realm changes, re-sync this copy.

## Validating `modelcontextprotocol/typescript-sdk` PR 1624 against this fixture

Verified runbook for the SEP-2350 server-side scope-challenge implementation. Three terminal windows. Both PR 1624's reference impl and mcpkit's experimental Go SDK pass this scenario 8/8 SUCCESS against this fixture.

### Terminal 1: this fixture

```bash
cd conf-auth/examples/auth-fixtures/keycloak
make up        # docker compose up -d --wait, ~30s for realm import
make wait      # block until the realm endpoint responds (sanity)
make tokens    # prints insufficient + sufficient tokens for a quick eyeball
```

### Terminal 2: PR 1624's reference server, wired to Keycloak

The fork ships a provider-neutral SUT in [`panyam/mcp-ts-sdk` on the `demo/scope-challenge-keycloak` branch](https://github.com/panyam/mcp-ts-sdk/tree/demo/scope-challenge-keycloak). That branch is forked from `modelcontextprotocol/typescript-sdk` and rebased on PR 1624's branch, with one example file added (`examples/server/src/scopeChallenge.ts`) and `jose` added to `examples/server/package.json` for JWKS-aware JWT verification. The same SUT drives any AS by pointing `ISSUER` at it (see the okta fixture for the Okta invocation).

```bash
cd ..   # parent of conf-auth
git clone https://github.com/panyam/mcp-ts-sdk.git
cd mcp-ts-sdk
git checkout demo/scope-challenge-keycloak
pnpm install && pnpm run build:all

# Start the SUT. Note the env var: Keycloak runs on http://localhost,
# so the issuer URL bypass is required. ISSUER defaults to this realm.
MCP_DANGEROUSLY_ALLOW_INSECURE_ISSUER_URL=true \
  ISSUER=http://localhost:8180/realms/mcpkit-test \
  pnpm --filter @modelcontextprotocol/examples-server exec \
  tsx src/scopeChallenge.ts
# → pr1624-scope-challenge SUT listening on http://localhost:3100/mcp
```

### Terminal 3: run the conformance scenario

```bash
cd conf-auth
npm install && npm run build

CONTEXT=$(make -s -C examples/auth-fixtures/keycloak tokens-context)
MCP_CONFORMANCE_CONTEXT="$CONTEXT" node dist/index.js server \
  --url http://localhost:3100/mcp \
  --scenario scope-challenge
```

Expected output:

```
Passed: 9/9, 0 failed, 0 warnings
```

Nine checks run: 8 always-on (HTTP 403 status, WWW-Authenticate shape, scope advertisement, resource_metadata link, retry success, etc.) plus 1 conditional on `accepted` OR-hierarchy. The demo SUTs declare `accepted: ['admin-write', 'admin']` on the scope-gated tool so a token carrying just the parent `admin` scope satisfies the gate via the OR escape hatch. The `make tokens-context` target mints three tokens accordingly and emits `features.acceptedScopes: true` in the context JSON.

Minimal-conforming SUTs that omit `accepted` see `Passed: 8/8` with the OR-hierarchy check emitting `SKIPPED`. Either shape (8/8 or 9/9) is a passing run; the 9th check is opt-in feature coverage.

## See also

For an experimental Go SDK that runs the same scenario against the same Keycloak realm, see [`panyam/mcpkit` `examples/auth/step-up-keycloak/`](https://github.com/panyam/mcpkit/tree/main/examples/auth/step-up-keycloak). Both SUTs pass `8/8 SUCCESS, 0 warnings` against this fixture, demonstrating wire-shape interop between PR 1624's reference impl and an independent Go implementation.

## Port conflicts

Port `8180` is the same port `mcpkit`'s `make upkcl` uses. If both are running, one will fail to bind. Either stop the other or override the port with `make up KC_PORT=8280`.
