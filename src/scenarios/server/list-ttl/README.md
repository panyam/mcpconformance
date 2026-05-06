# SEP-2549 List-TTL — Server Conformance

Tests an MCP server that emits the optional `ttl` (in seconds) cache-freshness hint on every paginated list response (`tools/list`, `prompts/list`, `resources/list`, `resources/templates/list`).

Three-state contract per the spec:

| State         | Wire shape        | Semantics                                                           |
| ------------- | ----------------- | ------------------------------------------------------------------- |
| Absent        | `ttl` key omitted | No server guidance — fall back to list_changed or client heuristics |
| Explicit zero | `"ttl": 0`        | Do not cache, always re-fetch                                       |
| Positive      | `"ttl": N`        | Fresh for N seconds                                                 |

Tagged `['extension', DRAFT_PROTOCOL_VERSION]`. Registered in `pendingClientScenariosList` so default `all-scenarios.test.ts` runs skip this suite (TTL field is draft).

## ClientScenario class

### `list-ttl` (`list-ttl.ts`)

Single class with 5 internal `ConformanceCheck` records. Verifying all three states requires three fixture servers (one per state); the scenario receives the positive-TTL URL via the standard `run(serverUrl)` argument and reads the other two from environment variables.

| Check                                | What it tests                                                                                                                |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `list-ttl-positive-on-all-endpoints` | Positive TTL surfaces on all four list endpoints with the same value (positive integer JSON number)                          |
| `list-ttl-explicit-zero-preserved`   | Explicit zero is present on the wire (distinguishable from absent) — catches naive `int` + `omitempty` that drops `&0`       |
| `list-ttl-absent-when-unset`         | `ttl` MUST be absent (not present-with-zero) when server has no TTL configured                                               |
| `list-ttl-coexists-with-payload`     | TTL doesn't disturb the existing payload arrays (`tools` / `prompts` / `resources` / `resourceTemplates`) — regression guard |
| `list-ttl-wire-type-is-number`       | `ttl` MUST be a JSON number (catches `*string`-encoded TTLs)                                                                 |

`list-ttl-explicit-zero-preserved` and `list-ttl-absent-when-unset` emit `INFO` (not FAILURE) when their respective env vars are unset — verifying all three states is best-effort, not a spec violation if a contributor only points at the positive-TTL fixture.

## Required server fixtures (three of them)

Three independent fixture servers, one per TTL state:

- **Positive TTL** — server configured with TTL > 0 (e.g., `60` seconds)
- **Explicit zero** — server configured with TTL = 0
- **Unset** — server with no TTL configuration (TTL key omitted on the wire)

Any-language fixture works. One example reference implementation is at https://github.com/panyam/mcpkit/tree/main/examples/list-ttl, which spawns three Go binaries with the appropriate flags.

## Running

```bash
LIST_TTL_POSITIVE_URL=http://localhost:18094/mcp \
LIST_TTL_POSITIVE_CMD="/path/to/list-ttl-server --port 18094 --ttl 60" \
LIST_TTL_ZERO_URL=http://localhost:18095/mcp \
LIST_TTL_ZERO_CMD="/path/to/list-ttl-server --port 18095 --ttl 0" \
LIST_TTL_UNSET_URL=http://localhost:18096/mcp \
LIST_TTL_UNSET_CMD="/path/to/list-ttl-server --port 18096" \
  npx vitest run src/scenarios/server/list-ttl/
```

For an externally-running fixture, omit `*_CMD` env vars; the runner will skip the spawn step and connect directly. If `LIST_TTL_POSITIVE_URL` is unset entirely, the suite is `describe.skip`'d.
