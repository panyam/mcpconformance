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

Every check grades the **wire**, never the SDK's developer API. That is what
makes the matrix durable: `modelcontextprotocol/typescript-sdk#1624` was
rewritten on 2026-08-24 from declarative per-tool scopes to a request-time
callback (`f724f405`), and all nine checks passed unchanged against the new API.
The OR-hierarchy check included, since it is opt-in and behavioural (call with a
parent-scope token, assert 2xx) rather than an assertion about SDK config.

## Matrix

All cells re-verified **2026-08-29**.

| SDK ↓ / Provider →                                                            | Keycloak | Okta   | Descope | Entra | WorkOS |
| ----------------------------------------------------------------------------- | -------- | ------ | ------- | ----- | ------ |
| **TypeScript (PR 1624 ref)** — `panyam/mcp-ts-sdk` `examples/scope-challenge` | ✅ 9/9   | ✅ 9/9 | —       | —     | —      |
| **mcpkit (Go)** — `panyam/mcpkit` `examples/auth/step-up`                     | ✅ 9/9   | ✅ 9/9 | —       | —     | —      |

Legend: ✅ N/9 = checks passing · — = not yet run · ⚠️ = partial (see notes).

The TypeScript SUT is pinned at tag
[`sut/verified-20260829`](https://github.com/panyam/mcp-ts-sdk/tree/sut/verified-20260829/examples/scope-challenge)
on `panyam/mcp-ts-sdk`. The tag is the reproducible ref; the branch moves as
PR 1624 does.

**What the TypeScript row actually tested.** The SDK under test is
`SamMorrowDrums/typescript-sdk` `scope-challenge-server-sdk` at `77846c28`, which
is PR 1624's head: upstream `main` as of 2026-08-26 plus the single feature
commit `f724f405`. The tag adds exactly one commit on top, and it touches
`examples/` and `pnpm-lock.yaml` only, so no SDK package code is modified by the
harness. This cannot be run against upstream `main`, which has no
`packages/server/src/server/scopeChallenge.ts` and will not compile. Note that
`main` has since moved ahead of Sam's branch (`70de0c8b`, unrelated to scopes).

## How each cell is produced

Both SUTs are provider-neutral. One binary per SDK, pointed at an issuer:

1. Provision + mint tokens from the provider fixture: `make -C <provider> provision` (cloud providers) or `make -C <provider> up` (docker), then `make -C <provider> tokens-context`.
2. Start the SDK's SUT against that issuer:
   - TypeScript: `ISSUER=<ISSUER> [AUDIENCE=<AUD>] npx tsx examples/scope-challenge/server.ts`
   - mcpkit: `go run ./step-up -issuer <ISSUER> [-audience <AUD>]` from `examples/auth/`
3. Run the scenario: `MCP_CONFORMANCE_CONTEXT="$(make -s -C <provider> tokens-context)" node dist/index.js server --url http://localhost:<port>/mcp --scenario scope-challenge`

An `http://` issuer (the local Keycloak fixture) needs
`MCP_DANGEROUSLY_ALLOW_INSECURE_ISSUER_URL=true` on the TypeScript SUT. Okta
needs no such flag. Note that `okta.env` exports `OKTA_ISSUER`, so pass
`ISSUER="$OKTA_ISSUER"`; the SUTs fall back to the Keycloak default when `ISSUER`
is unset, and the startup banner is what catches the mistake.

## Beyond the scenario

The TypeScript SUT also carries a second tool, `read_item`, whose required scope
depends on a call argument (`visibility: "public"` needs `tools-read`,
`"private"` needs `admin-write`). No conformance check grades it, because the
scenario predates the callback API. It is there because argument-dependent
scopes are the case that motivated the 1624 rewrite (GitHub's `workflow` scope
depends on which file paths a call touches, and repo-vs-org admin depends on the
arguments), and a registration-time declaration cannot express it at all. Worth
folding into the scenario as a tenth check if the WG wants it graded.

## Provider notes

- **Keycloak** — local docker fixture (`keycloak/`), hermetic. Scopes in the `scope` claim (string); no `aud` on client_credentials.
- **Okta** — real tenant fixture (`okta/`), custom authorization server. Scopes in the `scp` claim (array); sets `aud=api://default`. Surfacing `scp` support was a real SDK fix in both mcpkit and the TS SUT. `provision` needs an SSWS admin token, which Okta expires after 30 days of inactivity; a stale one shows up as `401: Invalid token provided` on the first API call.
- **Descope / Entra / WorkOS** — not yet run. Each needs to mint a custom scope into a JWKS-verifiable access token over a machine grant; add a `<provider>/` fixture mirroring `okta/` and fill the column.

Offers of a fixture that have not yet been taken up: Kevin Gao (Descope,
in-channel), mooreds (2026-08-24), Bruno Vicco (2026-08-11), Aaron Parecki
(Okta, 2026-08-25). `panyam/mcpkit#847` tracks the Entra fixture from the
EMA/ID-JAG side.

## Adding a provider

Add a fixture dir under this folder (mirror `okta/`: provision + tokens-context +
teardown + README), run the scenario against each SDK's SUT, and fill the column
above. No SDK code changes should be needed unless the provider uses a scope
claim shape no SUT handles yet.
