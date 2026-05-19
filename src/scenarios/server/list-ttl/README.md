# SEP-2549 List-TTL — mcpkit-stricter sentinel

SEP-2549 (TTL for List Results) merged Final on the MCP specification on
2026-05-15. Canonical, brand-neutral conformance coverage of the merged
spec lives upstream in `modelcontextprotocol/conformance` PR 275
(`src/scenarios/server/caching.ts`, branch `ttl-tests`).

This directory is a thin **sentinel**: it verifies the merged wire shape
end-to-end against the mcpkit example fixture and adds one mcpkit-stricter
check. It is not a replacement for the upstream `caching.ts` coverage —
point a full conformance run at that once it merges.

## Merged wire shape

Each of `tools/list`, `prompts/list`, `resources/list`,
`resources/templates/list`, and `resources/read` MAY carry two cache hints:

| Field        | Type   | Meaning                                                  |
| ------------ | ------ | -------------------------------------------------------- |
| `ttlMs`      | number | integer milliseconds; cache-freshness hint               |
| `cacheScope` | string | `"public"` or `"private"`; absent defaults to `"public"` |

Per the merged spec an absent `ttlMs` and an explicit `ttlMs: 0` are
client-equivalent (both "immediately stale").

## Checks

Single `ListTtlScenario` class. Verifying the three `ttlMs` states needs
three fixture servers; the scenario receives the positive URL via the
standard `run(serverUrl)` argument and reads the other two from the
environment.

| Check                                   | What it tests                                                                                                              |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `list-ttl-ms-positive-on-all-endpoints` | `ttlMs` surfaces on all five SEP-2549 endpoints as a uniform positive integer, alongside the payload                       |
| `list-ttl-explicit-zero-distinct`       | **mcpkit-stricter** — explicit `ttlMs: 0` is present on the wire, distinct from absent (spec treats the two as equivalent) |
| `list-ttl-ms-absent-when-unset`         | `ttlMs` and `cacheScope` are absent when the server configures no cache hints                                              |
| `list-ttl-cache-scope`                  | `cacheScope` surfaces on all five endpoints as a `"public"`/`"private"` string                                             |
| `list-ttl-no-stale-seconds-field`       | the pre-merge `ttl` (seconds) field is gone — renamed to `ttlMs` (milliseconds)                                            |

`list-ttl-explicit-zero-distinct` and `list-ttl-ms-absent-when-unset` emit
`INFO` (not FAILURE) when their fixture env vars are unset — verifying all
three states is best-effort.

The `source` is `{ introducedIn: DRAFT_PROTOCOL_VERSION }`; default
`all-scenarios` runs that target a released protocol version skip it.

## Required server fixtures (three of them)

Three independent fixture servers, one per `ttlMs` state:

- **Positive** — `ttlMs > 0`, plus an explicit `cacheScope`
- **Explicit zero** — `ttlMs` set to `0`
- **Unset** — no cache hints configured (`ttlMs` / `cacheScope` omitted)

Any-language fixture works. The reference implementation spawns three Go
binaries from <https://github.com/panyam/mcpkit/tree/main/examples/list-ttl>.

## Running

```bash
LIST_TTL_POSITIVE_URL=http://localhost:18094/mcp \
LIST_TTL_POSITIVE_CMD="/path/to/list-ttl-demo --serve --addr=:18094 --ttl-ms=60000 --cache-scope=public" \
LIST_TTL_ZERO_URL=http://localhost:18095/mcp \
LIST_TTL_ZERO_CMD="/path/to/list-ttl-demo --serve --addr=:18095 --ttl-ms=0" \
LIST_TTL_UNSET_URL=http://localhost:18096/mcp \
LIST_TTL_UNSET_CMD="/path/to/list-ttl-demo --serve --addr=:18096" \
  npx vitest run src/scenarios/server/list-ttl/
```

For an externally-running fixture, omit the `*_CMD` env vars; the runner
connects directly. If `LIST_TTL_POSITIVE_URL` is unset entirely, the suite
is `describe.skip`'d.
