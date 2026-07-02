# Okta fixture for auth conformance scenarios

An Okta tenant configured to issue scoped OAuth access tokens for MCP
authorization-server conformance tests. Sibling to `../keycloak/`; currently
driven by the `scope-challenge` scenario (SEP-2350 step-up).

Unlike the Keycloak fixture there is no container to boot — Okta is SaaS. Setup
is a one-time `provision` against a real tenant, then `tokens-context` mints the
`MCP_CONFORMANCE_CONTEXT` blob the scenario consumes. That blob is byte-identical
in shape to the Keycloak fixture's, so the scenario runs unchanged against either
provider.

## What it gives you

- The tenant's pre-existing `default` custom authorization server (issuer
  `https://<tenant>.okta.com/oauth2/default`, audience `api://default`)
- Four custom scopes matching the Keycloak realm: `tools-read`, `tools-call`,
  `admin-write`, `admin`
- An API Services (client_credentials) app `MCPDev`
- A dedicated access policy `mcpdev-cc` granting that client the
  `client_credentials` grant + those scopes
- Make targets to mint under-scoped / sufficient / accepted-hierarchy tokens

## Prerequisites

An Okta org with API Access Management (the free Integrator plan has it). Then an
**SSWS admin API token**: Security → API → Tokens → Create Token. Export:

```bash
export OKTA_ORG_URL="https://<tenant>.okta.com"   # bare host, no /oauth2/default
export OKTA_API_TOKEN="<the SSWS token>"
```

The SSWS token is only used by `provision` / `clean`. Revoke it when done — the
conformance scenario itself uses only the client_id/secret in `okta.env`.

## Provision

```bash
make provision        # creates scopes + app + policy, writes okta.env (mode 600)
```

`provision` is idempotent: re-running reuses existing objects by name and always
leaves the app with exactly one known-good client secret (Okta caps secrets at
two, so it prunes and re-mints). `okta.env` is gitignored.

## Mint the conformance context

```bash
make tokens-context   # prints MCP_CONFORMANCE_CONTEXT JSON (self-sources okta.env)
```

The three tiers: `insufficient` = `tools-read` (valid but lacks `admin-write`),
`sufficient` = `admin-write`, `acceptedHierarchy` = `admin` (OR-hierarchy parent).

## Validating a SUT against this fixture

The scope-challenge scenario is blind to both provider and SUT — you point it at
a server-under-test URL with the context blob above. Run it against **both** SUTs
to produce cross-SDK evidence:

- **mcpkit (Go)**: `panyam/mcpkit` `examples/auth/step-up-okta` — verifier pointed
  at this issuer + JWKS.
- **TS PR 1624**: `panyam/mcp-ts-sdk` `demo/scope-challenge-*` — same, repointed
  from Keycloak to this issuer.

```bash
export MCP_CONFORMANCE_CONTEXT="$(make -s tokens-context)"
# then run the scope-challenge scenario against each SUT's /mcp URL
```

## Teardown

```bash
make clean            # deletes the MCPDev app, mcpdev-cc policy, and custom scopes
```
