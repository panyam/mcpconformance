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

End-to-end runbook for the SEP-2350 server-side scope-challenge implementation. Three terminal windows.

### Terminal 1: this fixture

```bash
cd conf-auth/examples/auth-fixtures/keycloak
make up        # docker compose up -d --wait, ~30s for realm import
make wait      # block until the realm endpoint responds (sanity)
make tokens    # prints insufficient + sufficient tokens for a quick eyeball
```

### Terminal 2: PR 1624's reference server

Clone the TypeScript SDK and check out PR 1624's branch alongside this repo:

```bash
cd ..   # parent of conf-auth
git clone https://github.com/modelcontextprotocol/typescript-sdk.git typescript-sdk-pr1624
cd typescript-sdk-pr1624
git fetch origin pull/1624/head:pr1624
git checkout pr1624
pnpm install && pnpm run build:all
```

Start the SDK's conformance server, configured to trust the Keycloak from terminal 1 as its authorization server:

```bash
cd test/conformance
MCP_AUTH_ISSUER=http://localhost:8180/realms/mcpkit-test \
  PORT=3100 \
  pnpm run test:conformance:server:run
```

Exact env-var names depend on PR 1624's reference server scaffolding. Adjust if the PR's docs name them differently.

### Terminal 3: run the conformance scenario

```bash
cd conf-auth
npm install && npm run build

CONTEXT=$(make -s -C examples/auth-fixtures/keycloak tokens-context)
node dist/index.js server \
  --url http://localhost:3100/mcp \
  --scenario scope-challenge \
  --context "$CONTEXT"
```

Expected output: all `scope-challenge-*` checks SUCCESS.

## See also

For an experimental Go SDK that runs the same scenario against the same Keycloak realm, see [`panyam/mcpkit` `examples/auth/step-up-keycloak/`](https://github.com/panyam/mcpkit/tree/main/examples/auth/step-up-keycloak).

## Port conflicts

Port `8180` is the same port `mcpkit`'s `make upkcl` uses. If both are running, one will fail to bind. Either stop the other or override the port with `make up KC_PORT=8280`.
