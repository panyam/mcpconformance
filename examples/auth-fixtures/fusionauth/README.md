# FusionAuth fixture for auth conformance scenarios

A self-contained FusionAuth instance configured to issue scoped OAuth tokens for
MCP authorization-server conformance tests. Currently driven by `scope-challenge`
(SEP-2350 step-up); reusable by future server-side auth scenarios.

## What it gives you

- FusionAuth running on `http://localhost:9011`
- Entity type `mcp-resource` with four permissions: `tools-read`, `tools-call`,
  `admin-write`, `admin`
- Target entity `mcp-resource-server` and client entity `mcp-client`
- A grant giving `mcp-client` all four permissions on `mcp-resource-server`
- Make targets for minting under-scoped and properly-scoped tokens for scenarios

## How FusionAuth scopes work here (and the limitation)

FusionAuth's `client_credentials` grant is built on **Entity Management** rather
than application-level OAuth scopes. Tokens carry scopes in the structured form:

```
target-entity:<target-entity-uuid>:<permission>
```

For example, the "sufficient" token in this fixture carries:

```
target-entity:b1b2c3d4-0002-0002-0002-000000000001:admin-write
```

The `scope-challenge` scenario passes tokens to a server-under-test (SUT) as
opaque Bearer strings and then asserts on the HTTP 403 / `WWW-Authenticate`
response shape — it never inspects the token payload. The reference SUT
(`examples/servers/typescript/scope-challenge-server.ts`) uses exact bearer
token string matching, so the `target-entity:...` format is transparent to it.

**Limitation:** a production SUT that validates the JWT and extracts the `scope`
claim would see `target-entity:...:admin-write` rather than the bare string
`admin-write`. Such a SUT would need to map the entity permission back to its
internal scope model. This fixture is therefore best suited to testing the
conformance harness wire-shape, not a full JWT-validating SUT pointed at
FusionAuth as its authorization server.

## License requirement

Entity Management (Machine-to-Machine / `client_credentials`) requires a
FusionAuth **paid plan (Starter or higher)**. It is not available on the free
Community plan. See https://fusionauth.io/pricing for details.

Export your license key before running `make up`:

```bash
export FUSIONAUTH_LICENSE_KEY=<your-license-key>
```

The key is passed into the container at startup and activated via the Reactor API
in kickstart. It is never written to disk by the fixture.

## Running the fixture

### Terminal 1: start FusionAuth

```bash
export FUSIONAUTH_LICENSE_KEY=<your-license-key>
cd examples/auth-fixtures/fusionauth
make up        # docker compose up -d --wait, ~60s for first boot + kickstart
make wait      # block until FusionAuth responds (sanity check)
```

### Terminal 2: start the scope-challenge SUT

**Important:** mint the context once and reuse it for both the SUT and the
scenario. Each call to `make tokens-context` mints new JWTs — if the SUT and
the scenario use different token sets, the scenario will get 403s on the
"sufficient" checks.

```bash
cd <conformance-repo-root>

# Mint once and save
export CONTEXT=$(make -s -C examples/auth-fixtures/fusionauth tokens-context)

INSUFFICIENT=$(echo "$CONTEXT" | python3 -c "import json,sys; print(json.load(sys.stdin)['tokens']['insufficient'])")
SUFFICIENT=$(echo "$CONTEXT"   | python3 -c "import json,sys; print(json.load(sys.stdin)['tokens']['sufficient'])")
ACCEPTED=$(echo "$CONTEXT"     | python3 -c "import json,sys; print(json.load(sys.stdin)['tokens']['acceptedHierarchy'])")

cd examples/servers/typescript
PORT=3013 \
  SUFFICIENT_TOKEN="$SUFFICIENT" \
  INSUFFICIENT_TOKEN="$INSUFFICIENT" \
  ACCEPTED_TOKEN="$ACCEPTED" \
  REQUIRED_SCOPE="admin-write" \
  SCOPE_GATED_TOOL="admin_call" \
  npx tsx scope-challenge-server.ts
```

### Terminal 3: run the conformance scenario

Use the same `$CONTEXT` exported in Terminal 2 — do not call `make tokens-context`
again here.

```bash
cd <conformance-repo-root>
MCP_CONFORMANCE_CONTEXT="$CONTEXT" node dist/index.js server \
  --url http://localhost:3013/mcp \
  --scenario scope-challenge
```

Expected output:

```
Passed: 8/8, 0 failed, 1 warning
```

The warning is `scope-challenge-resource-metadata-link` — the reference SUT does
not advertise a `resource_metadata` URL in its challenge, which is a SHOULD per
RFC 9728. The 9th check (`scope-challenge-accepted-or-hierarchy`) runs as SUCCESS
because the `acceptedHierarchy` token is provided in the context.

### One-shot alternative (single terminal)

Mint once, start the SUT in the background, run the scenario, then clean up:

```bash
cd <conformance-repo-root>
export CONTEXT=$(make -s -C examples/auth-fixtures/fusionauth tokens-context)
INSUFFICIENT=$(echo "$CONTEXT" | python3 -c "import json,sys; print(json.load(sys.stdin)['tokens']['insufficient'])")
SUFFICIENT=$(echo "$CONTEXT"   | python3 -c "import json,sys; print(json.load(sys.stdin)['tokens']['sufficient'])")
ACCEPTED=$(echo "$CONTEXT"     | python3 -c "import json,sys; print(json.load(sys.stdin)['tokens']['acceptedHierarchy'])")

cd examples/servers/typescript
PORT=3013 SUFFICIENT_TOKEN="$SUFFICIENT" INSUFFICIENT_TOKEN="$INSUFFICIENT" \
  ACCEPTED_TOKEN="$ACCEPTED" REQUIRED_SCOPE="admin-write" SCOPE_GATED_TOOL="admin_call" \
  npx tsx scope-challenge-server.ts &
SUT_PID=$!
sleep 2

cd <conformance-repo-root>
MCP_CONFORMANCE_CONTEXT="$CONTEXT" node dist/index.js server \
  --url http://localhost:3013/mcp \
  --scenario scope-challenge

kill $SUT_PID
```

## Port conflicts

Port `9011` is FusionAuth's default. If you already have a local FusionAuth
instance running on that port, override with:

```bash
make up FA_PORT=9111
make tokens-context FA_PORT=9111
```

## See also

- `../keycloak/` — self-contained Keycloak fixture for the same scenario
- `../okta/` — SaaS Okta fixture (no Docker) for the same scenario
- `../../servers/typescript/scope-challenge-server.ts` — the reference SUT used
  above; accepts exact token strings without JWT decoding
