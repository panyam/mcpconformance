# SEP-2350 scope-challenge interop matrix

Coverage of the `scope-challenge` conformance scenario (SEP-2350 server-side
step-up: RFC 6750 §3.1 `insufficient_scope` challenge + RFC 9728 PRM discovery)
across **SDKs** (rows) and **authorization servers** (columns). Each cell is the
result of running the scenario against that SDK's SUT, backed by that provider's
fixture in this directory.

The scenario runs 9 checks: 403 on under-scoped call, WWW-Authenticate present /
Bearer scheme / `error="insufficient_scope"` / scope advertised / least-privilege
(required-only) / resource_metadata link, 2xx on sufficient token, and the
accepted OR-hierarchy.

## Matrix

| SDK ↓ / Provider →                                                     | Keycloak | Okta   | Descope | Entra | WorkOS |
| ---------------------------------------------------------------------- | -------- | ------ | ------- | ----- | ------ |
| **TypeScript (PR 1624 ref)** — `panyam/mcp-ts-sdk` `scopeChallenge.ts` | ✅ 9/9   | ✅ 9/9 | —       | —     | —      |
| **mcpkit (Go)** — `panyam/mcpkit` `examples/auth/step-up`              | ✅ 9/9   | ✅ 9/9 | —       | —     | —      |

Legend: ✅ N/9 = checks passing · — = not yet run · ⚠️ = partial (see notes).

## How each cell is produced

Both SUTs are provider-neutral — one binary per SDK, pointed at an issuer:

1. Provision + mint tokens from the provider fixture: `make -C <provider> provision` (cloud providers) or `make -C <provider> up` (docker), then `make -C <provider> tokens-context`.
2. Start the SDK's SUT against that issuer:
   - TypeScript: `ISSUER=<ISSUER> [AUDIENCE=<AUD>] tsx src/scopeChallenge.ts`
   - mcpkit: `go run ./examples/auth/step-up -issuer <ISSUER> [-audience <AUD>]`
3. Run the scenario: `MCP_CONFORMANCE_CONTEXT="$(make -s -C <provider> tokens-context)" node dist/index.js server --url http://localhost:<port>/mcp --scenario scope-challenge`

## Provider notes

- **Keycloak** — local docker fixture (`keycloak/`), hermetic. Scopes in the `scope` claim (string); no `aud` on client_credentials.
- **Okta** — real tenant fixture (`okta/`), custom authorization server. Scopes in the `scp` claim (array); sets `aud=api://default`. Surfacing `scp` support was a real SDK fix in both mcpkit and the TS example verifier.
- **Descope / Entra / WorkOS** — not yet run. Descope has offered to contribute a fixture. Each needs to mint a custom scope into a JWKS-verifiable access token over a machine grant; add a `<provider>/` fixture mirroring `okta/` and a row/column result here.

## Adding a provider

Add a fixture dir under this folder (mirror `okta/`: provision + tokens-context + teardown + README), run the scenario against each SDK's SUT, and fill the column above. No SDK code changes should be needed unless the provider uses a scope claim shape no SUT handles yet.
